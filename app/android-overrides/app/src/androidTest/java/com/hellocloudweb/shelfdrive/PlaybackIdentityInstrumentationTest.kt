package com.hellocloudweb.shelfdrive

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Account-scoped playback identity contract for PlaybackService.
 *
 * Canonical IDs are `v2:{ownerId}:{folderId|saved}:{messageId}`. These tests
 * exercise the persisted-history store directly (the same SharedPreferences
 * the service reads and writes) because the service persists through
 * `savePlayback` on every player transition.
 *
 * `savePlayback` is a private companion-object member, so it is reached
 * reflectively via `PlaybackService.Companion` — companion methods live on
 * the Companion class, not the outer class. Requires a device or emulator:
 * `connectedDebugAndroidTest`.
 */
@RunWith(AndroidJUnit4::class)
class PlaybackIdentityInstrumentationTest {
  private val context = ApplicationProvider.getApplicationContext<android.content.Context>()

  @Before
  fun resetHistory() {
    context.getSharedPreferences("telegram_drive_playback_v1", android.content.Context.MODE_PRIVATE)
      .edit().clear().commit()
  }

  private fun readHistory(): JSONArray {
    val raw = context.getSharedPreferences("telegram_drive_playback_v1", android.content.Context.MODE_PRIVATE)
      .getString("history", "[]")!!
    return JSONArray(raw)
  }

  private fun writeHistory(entries: List<JSONObject>) {
    val array = JSONArray()
    entries.forEach { array.put(it) }
    context.getSharedPreferences("telegram_drive_playback_v1", android.content.Context.MODE_PRIVATE)
      .edit().putString("history", array.toString()).commit()
  }

  private fun legacyEntry(mediaId: String, positionMs: Long = 90_000L): JSONObject = JSONObject().apply {
    put("mediaId", mediaId)
    put("title", "Legacy media")
    put("positionMs", positionMs)
    put("durationMs", 600_000L)
    put("completed", false)
    put("lastPlayedAt", 1L)
  }

  private fun canonicalEntry(mediaId: String, positionMs: Long): JSONObject = JSONObject().apply {
    put("mediaId", mediaId)
    put("title", "Canonical media")
    put("positionMs", positionMs)
    put("durationMs", 600_000L)
    put("completed", false)
    put("lastPlayedAt", 1L)
  }

  /** Reflectively reaches the private companion savePlayback on the Companion class. */
  private fun savePlaybackDirect(mediaId: String, position: Long, duration: Long, completed: Boolean) {
    val save = PlaybackService.Companion::class.java.declaredMethods
      .firstOrNull { it.name == "savePlayback" }
      ?: throw AssertionError("PlaybackService.savePlayback companion method not found")
    save.isAccessible = true
    save.invoke(PlaybackService.Companion, context, mediaId, "Test media", position, duration, completed)
  }

  @Test
  fun resumePositionIsScopedToTheOwningAccountForIdenticalIds() {
    // Account A and account B both played folder 42 message 100: identical
    // legacy-style folder/message numbers, distinct canonical IDs.
    val aId = "v2:100:42:900"
    val bId = "v2:200:42:900"
    writeHistory(listOf(canonicalEntry(aId, 123_000L)))

    assertEquals(123_000L, PlaybackService.getResumePosition(context, aId))
    assertEquals(0L, PlaybackService.getResumePosition(context, bId))
    assertEquals(0L, PlaybackService.getResumePosition(context, "v2:200:saved:900"))
  }

  @Test
  fun savedMessagesStaysDistinctFromANumberedFolder() {
    writeHistory(listOf(canonicalEntry("v2:100:saved:900", 45_000L)))

    assertEquals(45_000L, PlaybackService.getResumePosition(context, "v2:100:saved:900"))
    assertEquals(0L, PlaybackService.getResumePosition(context, "v2:100:900:900"))
  }

  @Test
  fun legacyEntriesWithoutAnOwnerAreNeverAttributedToCanonicalLookups() {
    // A pre-v2 entry has the same folder/message numbers the current account
    // is playing. The app only ever queries canonical IDs, so the canonical
    // lookup must return 0; an exact verbatim legacy-ID lookup still finds
    // the row (it is a plain equality scan) but nothing in the app performs
    // one — isolation comes from canonical ID construction plus purge.
    writeHistory(listOf(legacyEntry("42:900")))
    assertEquals(0L, PlaybackService.getResumePosition(context, "v2:100:42:900"))
    assertEquals(0L, PlaybackService.getResumePosition(context, "v2:200:42:900"))
    assertFalse(PlaybackService.isCanonicalMediaId("42:900"))
    assertTrue(PlaybackService.isCanonicalMediaId("v2:100:42:900"))
  }

  @Test
  fun savePlaybackPurgesLegacyEntriesAndKeepsCanonicalOnes() {
    writeHistory(
      listOf(
        legacyEntry("42:900"),
        legacyEntry("7:123"),
        canonicalEntry("v2:100:42:900", 10_000L),
      ),
    )
    savePlaybackDirect("v2:100:42:901", 5_000L, 600_000L, false)

    val history = readHistory()
    assertEquals(2, history.length())
    val ids = (0 until history.length()).map { history.optJSONObject(it)!!.optString("mediaId") }
    assertTrue(ids.contains("v2:100:42:900"))
    assertTrue(ids.contains("v2:100:42:901"))
    assertFalse(ids.contains("42:900"))
    assertFalse(ids.contains("7:123"))
  }

  @Test
  fun completedPlaybackResetsTheResumePosition() {
    savePlaybackDirect("v2:100:42:900", 599_000L, 600_000L, true)

    assertEquals(0L, PlaybackService.getResumePosition(context, "v2:100:42:900"))
  }

  @Test
  fun accountSwitchMidPlaybackKeepsTheOldAccountRowUntouched() {
    // Account A is mid-playback when the workspace switches to account B.
    // B plays the same-numbered file; A's row must remain A's.
    savePlaybackDirect("v2:100:42:900", 200_000L, 600_000L, false)
    savePlaybackDirect("v2:200:42:900", 30_000L, 600_000L, false)

    assertEquals(200_000L, PlaybackService.getResumePosition(context, "v2:100:42:900"))
    assertEquals(30_000L, PlaybackService.getResumePosition(context, "v2:200:42:900"))
  }
}
