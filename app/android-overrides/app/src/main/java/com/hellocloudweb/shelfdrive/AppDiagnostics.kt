package com.hellocloudweb.shelfdrive

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.Process
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.Collections
import java.util.IdentityHashMap

/**
 * App-private, local-only diagnostics. We intentionally do not read ApplicationExitInfo trace streams:
 * Android traces can contain arbitrary native memory, paths, and other sensitive process data. Native
 * crash/ANR reporting is therefore limited to the platform's structured exit-reason summary fields.
 */
internal object AppDiagnostics {
  private const val DIRECTORY = "app_diagnostics"
  private const val ACTIVE_FILE = "history.jsonl"
  private const val PREVIOUS_FILE = "history.1.jsonl"
  private const val MAX_FILE_BYTES = 256 * 1024
  private const val MAX_RECORD_CHARS = 8 * 1024
  private const val MAX_STACK_FRAMES = 12
  private const val EXIT_SUMMARY_LIMIT = 10
  private val lock = Any()
  @Volatile private var installed = false

  fun initialize(context: Context) {
    val appContext = context.applicationContext
    synchronized(lock) {
      val dir = diagnosticsDirectory(appContext)
      try {
        if (!dir.exists()) dir.mkdirs()
        // Install once per process, preserving and delegating to Android or another installed handler.
        if (!installed) {
          val previous = Thread.getDefaultUncaughtExceptionHandler()
          Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
              recordUncaught(appContext, throwable)
            } catch (_: Throwable) {
              // Diagnostics must never interfere with crash dispatch.
            } finally {
              if (previous != null) {
                previous.uncaughtException(thread, throwable)
              } else {
                thread.threadGroup?.uncaughtException(thread, throwable)
              }
            }
          }
          installed = true
        }
      } catch (_: Throwable) {
        // A storage/security failure must not prevent normal app startup.
      }
    }
    recordEvent(appContext, "app_start")
  }

  fun recordEvent(context: Context, event: String) {
    if (event !in ALLOWED_EVENTS) return
    append(context.applicationContext, JSONObject().apply {
      put("type", "lifecycle")
      put("event", event)
      put("timestamp", System.currentTimeMillis())
    })
  }

  fun getDiagnosticLog(context: Context): String {
    val appContext = context.applicationContext
    val history = synchronized(lock) {
      val dir = diagnosticsDirectory(appContext)
      val parts = listOf(File(dir, PREVIOUS_FILE), File(dir, ACTIVE_FILE))
        .filter { it.isFile }
        .mapNotNull { file ->
          try {
            file.readText(Charsets.UTF_8)
          } catch (_: IOException) {
            null
          }
        }
      parts.joinToString(separator = "")
    }
    val exits = recentExitSummaries(appContext)
    return buildString {
      append(history)
      exits.forEach { append(it.toString()).append('\n') }
    }
  }

  private fun recordUncaught(context: Context, throwable: Throwable) {
    val frameList = JSONArray()
    val seen = Collections.newSetFromMap(IdentityHashMap<Throwable, Boolean>())
    var current: Throwable? = throwable
    var framesAdded = 0
    var causes = 0
    val exceptionClass = safeTypeName(throwable.javaClass.name)
    while (current != null && causes < 8 && seen.add(current) && framesAdded < MAX_STACK_FRAMES) {
      for (frame in current.stackTrace) {
        if (framesAdded >= MAX_STACK_FRAMES) break
        val className = safeClassName(frame.className) ?: continue
        val methodName = safeSymbol(frame.methodName) ?: continue
        val fileName = frame.fileName?.let(::safeFileName)
        frameList.put(JSONObject().apply {
          put("class", className)
          put("method", methodName)
          put("file", fileName ?: JSONObject.NULL)
          put("line", frame.lineNumber.coerceAtLeast(-1))
        })
        framesAdded++
      }
      current = current.cause
      causes++
    }
    // Store only sanitized top-level exception class and frames; never read messages, thread names,
    // stack-trace rendering, source paths, or arbitrary exception data.
    append(context, JSONObject().apply {
      put("type", "java_uncaught")
      put("exceptionClass", exceptionClass)
      put("frames", frameList)
      put("timestamp", System.currentTimeMillis())
    })
  }

  private fun safeTypeName(value: String): String =
    value.takeIf { TYPE_NAME.matches(it) } ?: "unknown"

  private fun safeSymbol(value: String): String? = value.takeIf { SYMBOL.matches(it) }

  private fun safeClassName(value: String): String? = value.takeIf { FRAME_CLASS.matches(it) }

  private fun safeFileName(value: String): String? {
    // File names only, never directories. Reject rather than partially retain unusual values.
    val baseName = value.substringAfterLast('/').substringAfterLast('\\')
    return baseName.takeIf { FILE_NAME.matches(it) }
  }

  private fun append(context: Context, record: JSONObject) {
    val line = try {
      record.toString().take(MAX_RECORD_CHARS - 2) + "\n"
    } catch (_: RuntimeException) {
      return
    }
    synchronized(lock) {
      try {
        val directory = diagnosticsDirectory(context)
        if (!directory.exists() && !directory.mkdirs()) return
        val active = File(directory, ACTIVE_FILE)
        val bytes = line.toByteArray(Charsets.UTF_8)
        if (active.exists() && active.length() + bytes.size > MAX_FILE_BYTES) {
          val previous = File(directory, PREVIOUS_FILE)
          if (previous.exists()) previous.delete()
          if (!active.renameTo(previous)) active.delete()
        }
        FileOutputStream(active, true).use { stream ->
          stream.write(bytes)
          stream.flush()
          stream.fd.sync()
        }
      } catch (_: IOException) {
        // Diagnostics are best effort and must not disrupt app operation.
      } catch (_: SecurityException) {
        // App-private storage may be unavailable in unusual device states; fail closed.
      }
    }
  }

  @Suppress("DEPRECATION")
  private fun recentExitSummaries(context: Context): List<JSONObject> {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return emptyList()
    return try {
      val manager = context.getSystemService(ActivityManager::class.java) ?: return emptyList()
      manager.getHistoricalProcessExitReasons(context.packageName, 0, EXIT_SUMMARY_LIMIT)
        .orEmpty()
        .asSequence()
        .filter { info ->
          // Android 14+ exposes realUid; verify it. On Android 11-13 the API query is already scoped
          // to this exact package, but the platform has no public UID accessor for an additional check.
          Build.VERSION.SDK_INT < 34 || info.realUid == Process.myUid()
        }
        .filter { info ->
          val process = info.processName
          process == context.packageName || process.startsWith(context.packageName + ":")
        }
        .take(EXIT_SUMMARY_LIMIT)
        .map { info ->
          JSONObject().apply {
            put("type", "process_exit")
            put("reasonCode", info.reason)
            put("status", info.status)
            put("importance", info.importance)
            put("timestamp", info.timestamp)
            put("pid", info.pid)
          }
        }
        .toList()
    } catch (_: RuntimeException) {
      emptyList()
    } catch (_: SecurityException) {
      emptyList()
    }
  }

  private fun diagnosticsDirectory(context: Context): File = File(context.filesDir, DIRECTORY)

  private val ALLOWED_EVENTS = setOf(
    "app_start", "activity_created", "activity_started", "activity_stopped", "activity_destroyed"
  )
  private val TYPE_NAME = Regex("[A-Za-z0-9_.$]{1,200}")
  private val SYMBOL = Regex("[A-Za-z0-9_$<>-]{1,96}")
  private val FRAME_CLASS = Regex("[A-Za-z0-9_.$-]{1,192}")
  private val FILE_NAME = Regex("[A-Za-z0-9_.-]{1,96}")
}
