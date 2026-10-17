package com.hellocloudweb.shelfdrive

import android.database.sqlite.SQLiteDatabase
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Opt-in live integration test. Never uses production phone numbers or DCs. */
@RunWith(AndroidJUnit4::class)
class TelegramLoginFlowTest {
  private val context = ApplicationProvider.getApplicationContext<android.content.Context>()
  private fun findWebView(view: View): WebView? {
    if (view is WebView) return view
    if (view is ViewGroup) for (i in 0 until view.childCount) findWebView(view.getChildAt(i))?.let { return it }
    return null
  }
  private fun js(scenario: ActivityScenario<MainActivity>, script: String): String {
    val done = CountDownLatch(1)
    var result = "null"
    scenario.onActivity { activity ->
      val web = findWebView(activity.window.decorView)
      if (web == null) done.countDown() else web.evaluateJavascript(script) { result = it; done.countDown() }
    }
    assertTrue("WebView evaluation timed out", done.await(10, TimeUnit.SECONDS))
    return result
  }
  private fun waitFor(scenario: ActivityScenario<MainActivity>, expression: String, seconds: Int): Boolean {
    val until = System.currentTimeMillis() + seconds * 1000
    while (System.currentTimeMillis() < until) {
      if (js(scenario, "Boolean($expression)") == "true") return true
      Thread.sleep(500)
    }
    return false
  }
  private fun seedTestDc() {
    val session = File(context.filesDir, "telegram.session")
    for (suffix in listOf("", "-wal", "-shm")) File(session.path + suffix).delete()
    SQLiteDatabase.openOrCreateDatabase(session, null).use { db ->
      db.execSQL("CREATE TABLE dc_home (dc_id INTEGER NOT NULL PRIMARY KEY)")
      db.execSQL("CREATE TABLE dc_option (dc_id INTEGER NOT NULL PRIMARY KEY, ipv4 TEXT NOT NULL, ipv6 TEXT NOT NULL, auth_key BLOB)")
      db.execSQL("CREATE TABLE peer_info (peer_id INTEGER NOT NULL PRIMARY KEY, hash INTEGER, subtype INTEGER)")
      db.execSQL("CREATE TABLE update_state (pts INTEGER NOT NULL, qts INTEGER NOT NULL, date INTEGER NOT NULL, seq INTEGER NOT NULL)")
      db.execSQL("CREATE TABLE channel_state (peer_id INTEGER NOT NULL PRIMARY KEY, pts INTEGER NOT NULL)")
      db.execSQL("INSERT INTO dc_home VALUES (2)")
      // Official Telegram test DC endpoints only, including migration destinations.
      listOf(1 to "149.154.175.10:80", 2 to "149.154.167.40:80", 3 to "149.154.175.117:80").forEach { (id, ip) ->
        db.execSQL("INSERT INTO dc_option VALUES (?, ?, '[::1]:1', NULL)", arrayOf(id, ip))
      }
      db.execSQL("PRAGMA user_version = 1")
    }
  }
  @Test
  fun officialTestDcPhoneRequestReachesCodeEntry() {
    val arguments = InstrumentationRegistry.getArguments()
    val apiHash = arguments.getString("telegramApiHash")
    org.junit.Assume.assumeTrue("Live Telegram test requires explicit runtime credentials", apiHash != null)
    val phone = arguments.getString("telegramTestPhone", "9996621234")
    require(Regex("99966[1-3][0-9]{4}").matches(phone)) { "Only official test-account numbers are allowed" }
    seedTestDc()
    ActivityScenario.launch(MainActivity::class.java).use { scenario ->
      assertTrue("API credential setup did not appear", waitFor(scenario, "document.querySelector('#telegram-api-id')", 45))
      val id = JSONObject.quote(arguments.getString("telegramApiId"))
      val hash = JSONObject.quote(apiHash)
      js(scenario, """(() => {
        const set = (selector,value) => { const el=document.querySelector(selector); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value); el.dispatchEvent(new Event('input',{bubbles:true})); };
        set('#telegram-api-id',$id); set('#telegram-api-hash',$hash); return true;
      })()""")
      Thread.sleep(500)
      js(scenario, "document.querySelector('#telegram-api-id').closest('form').requestSubmit(); true")
      assertTrue("Phone entry did not appear after secure credential save", waitFor(scenario, "document.querySelector('#telegram-phone-number')", 20))
      // The country widget has no +999 option. Retain UI event handling but use
      // a test-only option so the actual request still comes from the real form.
      js(scenario, """(() => { const select=document.querySelector('select[aria-label="Country Code"]'); const option=document.createElement('option'); option.value='+999'; option.textContent='Telegram test DC'; select.appendChild(option); select.value='+999'; select.dispatchEvent(new Event('change',{bubbles:true})); return true; })()""")
      Thread.sleep(250)
      val local = JSONObject.quote(phone.removePrefix("999"))
      js(scenario, """(() => { const el=document.querySelector('#telegram-phone-number'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,$local); el.dispatchEvent(new Event('input',{bubbles:true})); return true; })()""")
      Thread.sleep(250)
      val start = System.currentTimeMillis()
      js(scenario, "document.querySelector('#telegram-phone-number').closest('form').requestSubmit(); true")
      val reached = waitFor(scenario, "document.querySelector('input[autocomplete=\"one-time-code\"]')", 105)
      val elapsed = System.currentTimeMillis() - start
      android.util.Log.i("TelegramLoginFlowTest", "phone_to_code_reached=$reached elapsed_ms=$elapsed")
      val screenshot = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
      val out = File(context.getExternalFilesDir(null), if (reached) "telegram-code-entry.png" else "telegram-login-failed.png")
      out.outputStream().use { screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
      screenshot.recycle()
      if (!reached) {
        // Only visible screen text, never input values or credentials.
        android.util.Log.e("TelegramLoginFlowTest", "screen_text=" + js(scenario, "document.body.innerText"))
      }
      assertTrue("The real APK did not reach the Telegram code-entry screen within 105 seconds", reached)
    }
  }
}
