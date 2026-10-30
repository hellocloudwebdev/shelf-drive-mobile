package com.hellocloudweb.shelfdrive

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.annotation.Keep
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import org.json.JSONArray
import org.json.JSONObject

@Keep
@androidx.annotation.OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {
  private lateinit var player: ExoPlayer
  private lateinit var mediaSession: MediaSession
  private val handler = Handler(Looper.getMainLooper())
  private val persistPlayback = object : Runnable {
    override fun run() {
      persistCurrentPlayback()
      handler.postDelayed(this, 10_000L)
    }
  }

  override fun onCreate() {
    super.onCreate()
    player = ExoPlayer.Builder(this).build()
    mediaSession = MediaSession.Builder(this, player).build()
    player.addListener(object : Player.Listener {
      override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) = persistCurrentPlayback()
      override fun onIsPlayingChanged(isPlaying: Boolean) = persistCurrentPlayback()
      override fun onPlaybackStateChanged(playbackState: Int) {
        persistCurrentPlayback(completed = playbackState == Player.STATE_ENDED)
      }
      override fun onPositionDiscontinuity(oldPosition: Player.PositionInfo, newPosition: Player.PositionInfo, reason: Int) = persistCurrentPlayback()
    })
    handler.post(persistPlayback)
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? {
    return if (controllerInfo.uid == applicationInfo.uid || controllerInfo.isTrusted) mediaSession else null
  }

  override fun onTaskRemoved(rootIntent: android.content.Intent?) {
    persistCurrentPlayback()
    if (!player.playWhenReady || player.mediaItemCount == 0) stopSelf()
  }

  override fun onDestroy() {
    handler.removeCallbacks(persistPlayback)
    persistCurrentPlayback()
    mediaSession.release()
    player.release()
    super.onDestroy()
  }

  private fun persistCurrentPlayback(completed: Boolean = false) {
    if (!::player.isInitialized) return
    val item = player.currentMediaItem ?: return
    // Only account-scoped IDs are persisted; anything else would recreate
    // app-wide history that cannot be attributed to a single account.
    val mediaId = item.mediaId.takeIf { isCanonicalMediaId(it) } ?: return
    val duration = player.duration.coerceAtLeast(0L)
    val position = if (completed) 0L else player.currentPosition.coerceAtLeast(0L)
    val title = item.mediaMetadata.title?.toString() ?: "Private media"
    savePlayback(this, mediaId, title, position, duration, completed)
  }

  companion object {
    private const val PREFS = "telegram_drive_playback_v1"
    private const val HISTORY = "history"
    private const val MAX_HISTORY = 20

    /**
     * Canonical history IDs are `v2:{ownerId}:{folderId|saved}:{messageId}`
     * (see app/src/services/playbackMediaId.ts). Legacy entries written before
     * the account-scoped format carry no owner, so they can never be
     * attributed to a specific account: they are ignored by every reader and
     * purged here on the next history write so they cannot crowd out
     * account-scoped entries. Nothing about them is logged.
     */
    private const val CANONICAL_MEDIA_ID_PREFIX = "v2:"

    fun isCanonicalMediaId(mediaId: String): Boolean = mediaId.startsWith(CANONICAL_MEDIA_ID_PREFIX)

    fun getResumePosition(context: Context, mediaId: String): Long {
      val history = readHistory(context)
      for (index in 0 until history.length()) {
        val entry = history.optJSONObject(index) ?: continue
        if (entry.optString("mediaId") == mediaId) return entry.optLong("positionMs", 0L)
      }
      return 0L
    }

    @JvmStatic
    fun getPlaybackHistoryJson(context: Context): String = readHistory(context).toString()

    private fun savePlayback(context: Context, mediaId: String, title: String, position: Long, duration: Long, completed: Boolean) {
      val existing = readHistory(context)
      val next = JSONArray()
      next.put(JSONObject().apply {
        put("mediaId", mediaId)
        put("title", title)
        put("positionMs", position)
        put("durationMs", duration)
        put("completed", completed)
        put("lastPlayedAt", System.currentTimeMillis())
      })
      for (index in 0 until existing.length()) {
        val entry = existing.optJSONObject(index) ?: continue
        val entryMediaId = entry.optString("mediaId")
        if (entryMediaId != mediaId && next.length() < MAX_HISTORY && isCanonicalMediaId(entryMediaId)) next.put(entry)
      }
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(HISTORY, next.toString()).apply()
    }

    private fun readHistory(context: Context): JSONArray {
      val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(HISTORY, "[]") ?: "[]"
      return try { JSONArray(raw) } catch (_: Exception) { JSONArray() }
    }
  }
}
