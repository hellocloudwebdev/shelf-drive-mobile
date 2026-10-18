package com.hellocloudweb.shelfdrive

import android.app.Notification
import android.app.NotificationManager
import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.BeforeClass
import org.junit.After
import org.junit.runner.RunWith

/**
 * Framework-level lifecycle coverage for the upload foreground service.
 * This deliberately does not authenticate to Telegram or transfer user data.
 */
@RunWith(AndroidJUnit4::class)
class UploadLifecycleInstrumentationTest {
  companion object {
    private lateinit var scenario: ActivityScenario<MainActivity>

    @JvmStatic
    @BeforeClass
    fun launchNativeRuntimeOnce() {
      // Tauri exits the process when its last Activity is destroyed. Closing an
      // ActivityScenario after each case kills the instrumentation runner too;
      // this is not an upload/background failure. Keep one Activity for this
      // suite and let the test runner own process cleanup. Deliberate Activity
      // destruction/process-death coverage must run in a separate process.
      scenario = ActivityScenario.launch(MainActivity::class.java)
    }
  }

  @After
  fun resetServiceAndBackgroundActivity() {
    UploadForegroundService.stopService(context)
    scenario.moveToState(Lifecycle.State.CREATED)
  }

  private val context = ApplicationProvider.getApplicationContext<Context>()
  private val notificationManager = context.getSystemService(NotificationManager::class.java)
  private val serviceIntent = Intent(context, UploadForegroundService::class.java)

  private fun update(active: Int, percent: Int, speed: Long, paused: Boolean) {
    val intent = Intent(context, UploadForegroundService::class.java).apply {
      action = "com.hellocloudweb.shelfdrive.TRANSFER_UPDATE"
      putExtra("active", active)
      putExtra("progress", percent)
      putExtra("speed", speed)
      putExtra("paused", paused)
    }
    context.startService(intent)
  }

  private fun ensureNotificationPermission() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      InstrumentationRegistry.getInstrumentation().uiAutomation.grantRuntimePermission(
        context.packageName,
        Manifest.permission.POST_NOTIFICATIONS,
      )
      assertEquals(
        PackageManager.PERMISSION_GRANTED,
        context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS),
      )
    }
  }

  private fun waitForNotificationText(expected: String, notificationId: Int = 2026, timeoutMs: Long = 5_000): Notification {
    val deadline = System.currentTimeMillis() + timeoutMs
    var notification: Notification? = null
    while (System.currentTimeMillis() < deadline) {
      notification = notificationManager.activeNotifications
        .firstOrNull { it.id == notificationId }
        ?.notification
      if (notification?.extras?.getCharSequence(Notification.EXTRA_TEXT)?.toString() == expected) {
        return notification!!
      }
      Thread.sleep(100)
    }
    assertNotNull("Upload notification was not posted with text '$expected'", notification)
    assertEquals(expected, notification!!.extras.getCharSequence(Notification.EXTRA_TEXT)?.toString())
    return notification
  }

  @Test
  fun foregroundServiceUpdatesAndSurvivesActivityBackgroundResume() {
    assertTrue("This test needs Android O+ foreground-service support", Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
    ensureNotificationPermission()
    UploadForegroundService.stopService(context)
    scenario.moveToState(Lifecycle.State.RESUMED)
    run {
      try {
        scenario.onActivity { activity ->
          assertTrue(activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))
        }
        context.startForegroundService(serviceIntent)
        waitForNotificationText("Preparing transfers…")
        update(active = 2, percent = 37, speed = 1024, paused = false)
        waitForNotificationText("2 active · 1.0 KB/s")

        scenario.moveToState(Lifecycle.State.CREATED)
        waitForNotificationText("2 active · 1.0 KB/s")

        // Exercise a real Activity stop/start transition while the transfer notification remains active.
        scenario.moveToState(Lifecycle.State.RESUMED)
        update(active = 1, percent = 63, speed = 2_097_152, paused = false)
        waitForNotificationText("1 active · 2.0 MB/s")

        update(active = 1, percent = 63, speed = 0, paused = true)
        waitForNotificationText("Transfers paused")
        scenario.moveToState(Lifecycle.State.CREATED)
        waitForNotificationText("Transfers paused")
        scenario.moveToState(Lifecycle.State.RESUMED)
        update(active = 1, percent = 64, speed = 512, paused = false)
        waitForNotificationText("1 active · 512.0 B/s")
      } finally {
        UploadForegroundService.stopService(context)
      }
    }
  }

  @Test
  fun productionServiceApiUsesUidtOrFallbackAcrossActivityBackgroundResume() {
    assertTrue("This test needs Android O+ foreground-service support", Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
    ensureNotificationPermission()
    UploadForegroundService.stopService(context)

    scenario.moveToState(Lifecycle.State.RESUMED)
    run {
      try {
        scenario.onActivity { activity ->
          assertTrue("Activity must be resumed before starting the transfer", activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))
        }

        // Exercise the production entry points: startService schedules UIDT on API 34+
        // when supported, otherwise it starts the data-sync foreground-service fallback.
        UploadForegroundService.startService(context)
        val uidtScheduled = TransferJobService.isPending(context)
        val notificationId = if (uidtScheduled) 2028 else 2026

        UploadForegroundService.updateService(context, active = 2, percent = 37, speed = 1024, isPaused = false)
        waitForNotificationText("2 active · 1.0 KB/s", notificationId)

        scenario.moveToState(Lifecycle.State.CREATED)
        waitForNotificationText("2 active · 1.0 KB/s", notificationId)
        UploadForegroundService.updateService(context, active = 1, percent = 63, speed = 2_097_152, isPaused = false)
        waitForNotificationText("1 active · 2.0 MB/s", notificationId)

        scenario.moveToState(Lifecycle.State.RESUMED)
        UploadForegroundService.updateService(context, active = 1, percent = 63, speed = 0, isPaused = true)
        waitForNotificationText("Transfers paused", notificationId)
        assertEquals("UIDT scheduling state should not change during Activity lifecycle transitions", uidtScheduled, TransferJobService.isPending(context))
      } finally {
        UploadForegroundService.stopService(context)
      }
    }
  }
}
