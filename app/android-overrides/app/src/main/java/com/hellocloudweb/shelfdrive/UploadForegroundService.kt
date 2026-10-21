package com.hellocloudweb.shelfdrive

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.annotation.Keep
import androidx.core.app.NotificationCompat

@Keep
class UploadForegroundService : Service() {
  private var activeCount = 0
  private var progress = 0
  private var speedBytesPerSecond = 0L
  private var paused = false

  companion object {
    private const val CHANNEL_ID = "UploadServiceChannel"
    private const val NOTIFICATION_ID = 2026
    private const val ACTION_UPDATE = "com.hellocloudweb.shelfdrive.TRANSFER_UPDATE"
    private const val ACTION_PAUSE = "com.hellocloudweb.shelfdrive.TRANSFER_PAUSE"
    private const val ACTION_RESUME = "com.hellocloudweb.shelfdrive.TRANSFER_RESUME"
    private const val ACTION_CANCEL = "com.hellocloudweb.shelfdrive.TRANSFER_CANCEL"
    private const val EXTRA_ACTIVE = "active"
    private const val EXTRA_PROGRESS = "progress"
    private const val EXTRA_SPEED = "speed"
    private const val EXTRA_PAUSED = "paused"
    private const val EXTRA_GENERATION = "service_generation"
    private val lifecyclePolicy = ForegroundServiceLifecyclePolicy()

    private fun startForegroundService(context: Context, intent: Intent) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
      else context.startService(intent)
    }


    @JvmStatic
    fun startService(context: Context) {
      MainActivity.requestTransferNotificationPermission()
      TransferRecoveryWorker.setPendingTransfers(context, true)
      if (TransferJobService.schedule(context)) return
      lifecyclePolicy.startAndDispatch { generation ->
        val intent = Intent(context, UploadForegroundService::class.java)
          .putExtra(EXTRA_GENERATION, generation)
        startForegroundService(context, intent)
      }
    }

    @JvmStatic
    fun updateService(context: Context, active: Int, percent: Int, speed: Long, isPaused: Boolean) {
      TransferRecoveryWorker.setPendingTransfers(context, active > 0 || isPaused)
      if (TransferJobService.isPending(context)) {
        TransferJobService.update(context, active, percent, speed, isPaused)
        return
      }
      lifecyclePolicy.startAndDispatch { generation ->
        val intent = Intent(context, UploadForegroundService::class.java).apply {
          action = ACTION_UPDATE
          putExtra(EXTRA_ACTIVE, active.coerceAtLeast(0))
          putExtra(EXTRA_PROGRESS, percent.coerceIn(0, 100))
          putExtra(EXTRA_SPEED, speed.coerceAtLeast(0L))
          putExtra(EXTRA_PAUSED, isPaused)
          putExtra(EXTRA_GENERATION, generation)
        }
        startForegroundService(context, intent)
      }
    }

    @JvmStatic
    fun stopService(context: Context) {
      TransferRecoveryWorker.setPendingTransfers(context, false)
      TransferJobService.cancel(context)
      lifecyclePolicy.stopAndDispatch(
        idleStop = {
          // Preserve harmless cleanup for a service started outside this API;
          // this path never issues a foreground-service start request.
          context.stopService(Intent(context, UploadForegroundService::class.java))
        },
        runningStop = {
          // stopService is allowed from the background and cannot resurrect the
          // instance. Startup stops are handled by onStartCommand instead.
          context.stopService(Intent(context, UploadForegroundService::class.java))
        },
      )
    }
  }

  private var serviceGeneration = 0L

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
    startAsForeground(createNotification())
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // A restart can reuse an instance whose earlier stop removed its
    // notification. Promote before terminal/stale cleanup too, so every
    // delivered foreground start satisfies Android's startup contract.
    startAsForeground(createNotification())
    val requestedGeneration = intent?.getLongExtra(EXTRA_GENERATION, 0L) ?: 0L
    val generation = if (requestedGeneration > 0L) requestedGeneration
      else lifecyclePolicy.onUntrackedServiceStart()
    when (lifecyclePolicy.onStartCommand(generation)) {
      ForegroundServiceLifecyclePolicy.StartDisposition.IGNORE_STALE,
      ForegroundServiceLifecyclePolicy.StartDisposition.STOP_TERMINAL -> {
        lifecyclePolicy.stopIfNotSuperseded(generation) {
          serviceGeneration = generation
          stopForeground(STOP_FOREGROUND_REMOVE)
          stopSelf(startId)
        }
        return START_NOT_STICKY
      }
      ForegroundServiceLifecyclePolicy.StartDisposition.PROCESS -> serviceGeneration = generation
    }
    when (intent?.action) {
      ACTION_UPDATE -> {
        activeCount = intent.getIntExtra(EXTRA_ACTIVE, activeCount).coerceAtLeast(0)
        progress = intent.getIntExtra(EXTRA_PROGRESS, progress).coerceIn(0, 100)
        speedBytesPerSecond = intent.getLongExtra(EXTRA_SPEED, speedBytesPerSecond).coerceAtLeast(0L)
        paused = intent.getBooleanExtra(EXTRA_PAUSED, paused)
        notifyProgress()
      }
      ACTION_PAUSE -> { paused = true; MainActivity.emitTransferAction("pause"); notifyProgress() }
      ACTION_RESUME -> { paused = false; MainActivity.emitTransferAction("resume"); notifyProgress() }
      ACTION_CANCEL -> {
        MainActivity.emitTransferAction("cancel")
        TransferRecoveryWorker.setPendingTransfers(this, false)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf(startId)
      }
    }
    return START_NOT_STICKY
  }

  override fun onTimeout(startId: Int, fgsType: Int) {
    MainActivity.emitTransferAction("timeout")
    Log.w("UploadService", "Android data-sync foreground-service timeout reached")
    TransferRecoveryWorker.schedule(this)
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf(startId)
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    lifecyclePolicy.onServiceDestroyed(serviceGeneration)
    super.onDestroy()
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    TransferRecoveryWorker.schedule(this)
    super.onTaskRemoved(rootIntent)
  }

  private fun startAsForeground(notification: Notification) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else startForeground(NOTIFICATION_ID, notification)
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      getSystemService(NotificationManager::class.java)?.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Shelf Drive transfers", NotificationManager.IMPORTANCE_LOW).apply {
          description = "Upload and download progress"
          setShowBadge(false)
        }
      )
    }
  }

  private fun actionIntent(action: String, requestCode: Int) = PendingIntent.getService(
    this, requestCode, Intent(this, UploadForegroundService::class.java)
      .setAction(action)
      .putExtra(EXTRA_GENERATION, serviceGeneration),
    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
  )

  private fun formatSpeed(bytes: Long): String {
    if (bytes <= 0L) return ""
    val units = arrayOf("B", "KB", "MB", "GB")
    var value = bytes.toDouble()
    var unit = 0
    while (value >= 1024.0 && unit < units.lastIndex) { value /= 1024.0; unit++ }
    return String.format(java.util.Locale.US, "%.1f %s/s", value, units[unit])
  }

  private fun createNotification(): Notification {
    val openApp = PendingIntent.getActivity(
      this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val state = when {
      paused -> "Transfers paused"
      activeCount > 0 && speedBytesPerSecond > 0 -> "$activeCount active · ${formatSpeed(speedBytesPerSecond)}"
      activeCount > 0 -> "$activeCount transfer${if (activeCount == 1) "" else "s"} active"
      else -> "Preparing transfers…"
    }
    val builder = NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("Shelf Drive transfers")
      .setContentText(state)
      .setSmallIcon(if (paused) android.R.drawable.ic_media_pause else android.R.drawable.stat_sys_upload)
      .setContentIntent(openApp)
      .setOnlyAlertOnce(true)
      .setOngoing(true)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setProgress(100, progress, activeCount == 0)

    if (paused) builder.addAction(android.R.drawable.ic_media_play, "Resume", actionIntent(ACTION_RESUME, 2))
    else builder.addAction(android.R.drawable.ic_media_pause, "Pause", actionIntent(ACTION_PAUSE, 1))
    builder.addAction(android.R.drawable.ic_menu_close_clear_cancel, "Cancel", actionIntent(ACTION_CANCEL, 3))
    return builder.build()
  }

  private fun notifyProgress() {
    getSystemService(NotificationManager::class.java)?.notify(NOTIFICATION_ID, createNotification())
  }
}
