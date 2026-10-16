package com.hellocloudweb.shelfdrive

import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.FeatureInfo
import android.content.pm.PackageManager
import androidx.work.WorkManager
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AndroidPlatformContractTest {
  private val context = ApplicationProvider.getApplicationContext<android.content.Context>()
  private val packageManager = context.packageManager

  @Test
  fun packageSupportsPhoneAndTelevisionLaunchers() {
    val phoneIntent = Intent(Intent.ACTION_MAIN)
      .addCategory(Intent.CATEGORY_LAUNCHER)
      .setPackage(context.packageName)
    val televisionIntent = Intent(Intent.ACTION_MAIN)
      .addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER)
      .setPackage(context.packageName)

    assertTrue(
      "The standard Android launcher activity must be discoverable",
      packageManager.queryIntentActivities(phoneIntent, PackageManager.MATCH_ALL).isNotEmpty()
    )
    assertTrue(
      "The Android/Google TV Leanback launcher activity must be discoverable",
      packageManager.queryIntentActivities(televisionIntent, PackageManager.MATCH_ALL).isNotEmpty()
    )
  }

  @Suppress("DEPRECATION")
  @Test
  fun backupIsDisabledAndTelevisionBannerIsPackaged() {
    val applicationInfo = packageManager.getApplicationInfo(context.packageName, 0)
    assertEquals(0, applicationInfo.flags and ApplicationInfo.FLAG_ALLOW_BACKUP)
    assertNotEquals(0, applicationInfo.banner)
  }

  @Suppress("DEPRECATION")
  @Test
  fun touchscreenIsOptional() {
    val packageInfo = packageManager.getPackageInfo(context.packageName, PackageManager.GET_CONFIGURATIONS)
    val touchscreen = packageInfo.reqFeatures?.firstOrNull { it.name == PackageManager.FEATURE_TOUCHSCREEN }
    assertTrue(touchscreen == null || touchscreen.flags and FeatureInfo.FLAG_REQUIRED == 0)
  }

  @Test
  fun workManagerIsInitializedWithTheApplicationConfiguration() {
    val application = context.applicationContext as ShelfDriveApplication
    val configuration = application.workManagerConfiguration
    assertEquals(10_000, configuration.minJobSchedulerId)
    assertEquals(11_000, configuration.maxJobSchedulerId)
    assertTrue(configuration.maxJobSchedulerId - configuration.minJobSchedulerId >= 1_000)
    WorkManager.getInstance(context)
  }

  @Test
  fun concurrentSameNamedCacheReservationsAreDistinct() {
    val workerCount = 24
    val ready = CountDownLatch(workerCount)
    val start = CountDownLatch(1)
    val executor = Executors.newFixedThreadPool(workerCount)
    val createdFiles = ConcurrentLinkedQueue<File>()
    val displayName = "same-name-${System.nanoTime()}.bin"
    try {
      val reservations = (0 until workerCount).map {
        executor.submit<File> {
          ready.countDown()
          start.await()
          MainActivity.createUniqueCacheFile(context.cacheDir, displayName).also { createdFiles.add(it) }
        }
      }
      assertTrue("All reservation workers should become ready", ready.await(5, TimeUnit.SECONDS))
      start.countDown()
      val files = reservations.map { it.get(10, TimeUnit.SECONDS) }
      assertEquals(workerCount, files.map { it.canonicalPath }.toSet().size)
      assertTrue(files.all { it.isFile })
    } finally {
      start.countDown()
      executor.shutdownNow()
      createdFiles.forEach { it.delete() }
    }
  }

  @Test
  fun failedCopyDeletesThePartiallyCreatedOutput() {
    val target = File(context.cacheDir, "partial-copy-${System.nanoTime()}.bin")
    assertTrue(target.createNewFile())
    try {
      val error = runCatching {
        MainActivity.copyAndVerifyToFile(target, 100L) { output ->
          output.write(byteArrayOf(1, 2, 3))
          throw IOException("injected write failure")
        }
      }.exceptionOrNull()
      assertTrue("The injected output failure must escape", error is IOException)
      assertFalse("A partial public-download output must be removed", target.exists())
    } finally {
      target.delete()
    }
  }
}
