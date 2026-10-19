package com.hellocloudweb.shelfdrive

import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.security.MessageDigest

/** Raw tombstones are sensitive, not sanitized text. Caller supplies an app-private no-backup dir.
 * No Android dependencies: storage policy can be exercised on the host without inducing a crash.
 */
internal class NativeExitTraceStore(private val directory: File) {
  data class Trace(val timestamp: Long, val pid: Int, val bytes: ByteArray, val truncated: Boolean)

  /** Open only AFTER the caller has checked package, process, UID, reason and API version. */
  @Synchronized
  fun capture(timestamp: Long, pid: Int, processName: String, now: Long,
              open: () -> InputStream?): String {
    return try {
      if (timestamp <= 0 || timestamp > now || pid <= 0) return "invalid_input"
      val key = key(timestamp, pid, processName)
      val complete = File(directory, "$key.pb")
      val legacyPartial = File(directory, "$key.partial.pb")
      if (complete.isFile || legacyPartial.isFile) return "saved"
      if (!directory.exists() && !directory.mkdirs()) return "unavailable"
      val input = open() ?: return "unavailable"
      val temporary = File(directory, "$key.tmp")
      try {
        var count = 0L
        input.use { source ->
          FileOutputStream(temporary).use { output ->
            val buffer = ByteArray(8192)
            while (true) {
              val read = source.read(buffer)
              if (read < 0) break
              if (read == 0) throw java.io.IOException("Non-progressing trace stream")
              output.write(buffer, 0, read)
              count += read
            }
            output.flush()
            output.fd.sync()
          }
        }
        if (count == 0L) return "unavailable"
        if (!temporary.renameTo(complete)) return "unavailable"
        "saved"
      } finally {
        temporary.delete()
      }
    } catch (_: Exception) {
      // Missing, inaccessible, and vendor-failing streams must not break the app.
      "unavailable"
    }
  }

  /** Explicit review may load full tombstones; capture/startup paths never invoke this method. */
  @Suppress("UNUSED_PARAMETER")
  @Synchronized
  fun snapshot(now: Long): List<Trace> {
    return try {
      directory.listFiles().orEmpty()
        .filter { it.isFile && FILE_PATTERN.matches(it.name) }
        .sortedWith(compareByDescending<File> { it.name.substringBefore('_').toLongOrNull() ?: 0L }
          .thenBy { it.name })
        .mapNotNull { file ->
          try {
            val fields = file.name.split('_')
            val timestamp = fields[0].toLongOrNull() ?: return@mapNotNull null
            val pid = fields[1].toIntOrNull() ?: return@mapNotNull null
            if (timestamp <= 0 || pid <= 0 || file.length() <= 0) return@mapNotNull null
            Trace(timestamp, pid, file.readBytes(), file.name.endsWith(".partial.pb"))
          } catch (_: Exception) { null }
        }
    } catch (_: Exception) { emptyList() }
  }

  private fun key(timestamp: Long, pid: Int, processName: String): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(processName.toByteArray(Charsets.UTF_8))
      .take(8).joinToString("") { "%02x".format(it.toInt() and 255) }
    return "${timestamp}_${pid}_$digest"
  }

  companion object {
    private val FILE_PATTERN = Regex("([0-9]{1,19})_([0-9]{1,10})_[a-f0-9]{16}(?:\\.partial)?\\.pb")
  }
}
