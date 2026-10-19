package com.hellocloudweb.shelfdrive

import android.app.ActivityManager
import android.app.ApplicationExitInfo
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
import java.util.Base64

/**
 * App-private, local-only diagnostics. Native tombstones are raw sensitive binary, not sanitized
 * events: keep them outside backup and expose them only through explicit local review/export.
 */
internal object AppDiagnostics {
  private const val DIRECTORY = "app_diagnostics"
  private const val ACTIVE_FILE = "history.jsonl"
  private const val MAX_STACK_FRAMES = 12
  private val lock = Any()
  @Volatile private var installed = false
  private val traceLock = Any()
  private var traceStore: NativeExitTraceStore? = null
  @Volatile private var captureScheduled = false

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
    // Platform trace IO must never delay Application.onCreate or transfer startup.
    synchronized(lock) {
      if (!captureScheduled) {
        captureScheduled = true
        try {
          Thread({
            try { captureNativeTraces(appContext, recentExits(appContext)) }
            catch (_: Throwable) { /* Best effort only; no error payload is retained. */ }
          }, "app-native-exit-capture").apply { isDaemon = true }.start()
        } catch (_: Throwable) { captureScheduled = false }
      }
    }
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
      try {
        File(dir, ACTIVE_FILE).takeIf { it.isFile }?.readText(Charsets.UTF_8).orEmpty()
      } catch (_: IOException) {
        ""
      }
    }
    val exits = recentExits(appContext)
    val statuses = captureNativeTraces(appContext, exits)
    val traces = synchronized(traceLock) {
      try { nativeTraceStore(appContext).snapshot(System.currentTimeMillis()) }
      catch (_: Exception) { emptyList() }
    }
    return buildString {
      append(history)
      exits.forEach { info ->
        append(JSONObject().apply {
          put("type", "process_exit")
          put("reasonCode", info.reason)
          put("status", info.status)
          put("importance", info.importance)
          put("timestamp", info.timestamp)
          put("pid", info.pid)
          statuses[exitKey(info)]?.let { put("nativeTrace", it) }
        }.toString()).append('\n')
      }
      if (traces.isNotEmpty()) {
        append("\n=== Sensitive app-native crash traces ===\n")
        append("Raw Android tombstone protobuf, base64 encoded; NOT sanitized. May contain memory, paths, identifiers, or secrets. Decode and inspect before sharing. Truncated traces are incomplete protobuf prefixes.\n")
        traces.forEach { trace ->
          append(JSONObject().apply {
            put("type", "native_exit_trace")
            put("timestamp", trace.timestamp)
            put("pid", trace.pid)
            put("encoding", "base64")
            put("format", "android_tombstone_protobuf")
            put("truncated", trace.truncated)
            put("capturedBytes", trace.bytes.size)
            put("data", Base64.getEncoder().encodeToString(trace.bytes))
          }.toString()).append('\n')
        }
      }
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
      record.toString() + "\n"
    } catch (_: RuntimeException) {
      return
    }
    synchronized(lock) {
      try {
        val directory = diagnosticsDirectory(context)
        if (!directory.exists() && !directory.mkdirs()) return
        val active = File(directory, ACTIVE_FILE)
        val bytes = line.toByteArray(Charsets.UTF_8)
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
  private fun recentExits(context: Context): List<ApplicationExitInfo> {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return emptyList()
    return try {
      val manager = context.getSystemService(ActivityManager::class.java) ?: return emptyList()
      manager.getHistoricalProcessExitReasons(context.packageName, 0, 0)
        .orEmpty()
        .asSequence()
        .filter { info ->
          // Both UID accessors have been public since API 30, including Android 12 and 13.
          info.realUid == Process.myUid() && info.packageUid == Process.myUid()
        }
        .filter { info ->
          val process = info.processName
          process == context.packageName || process.startsWith(context.packageName + ":")
        }
        .toList()
    } catch (_: RuntimeException) {
      emptyList()
    } catch (_: SecurityException) {
      emptyList()
    }
  }

  private fun nativeTraceStore(context: Context): NativeExitTraceStore =
    traceStore ?: NativeExitTraceStore(File(context.noBackupFilesDir, "native_exit_traces"))
      .also { traceStore = it }

  private fun exitKey(info: ApplicationExitInfo): String =
    "${info.timestamp}:${info.pid}:${info.processName}"

  private fun captureNativeTraces(context: Context, exits: List<ApplicationExitInfo>): Map<String, String> =
    synchronized(traceLock) {
      try {
        val store = nativeTraceStore(context)
        val now = System.currentTimeMillis()
        exits.filter { info ->
          NativeExitTracePolicy.canCapture(Build.VERSION.SDK_INT, context.packageName,
            info.processName, info.realUid, info.packageUid, Process.myUid(), info.reason)
        }.sortedByDescending { it.timestamp }.associate { info ->
          exitKey(info) to store.capture(info.timestamp, info.pid, info.processName, now) {
            info.traceInputStream
          }
        }
      } catch (_: Exception) { emptyMap() }
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
