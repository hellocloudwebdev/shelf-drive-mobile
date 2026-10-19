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
      prune(now)
      if (!eligibleTimestamp(timestamp, now) || pid <= 0) return "outside_retention"
      val key = key(timestamp, pid, processName)
      if (File(directory, "$key.pb").isFile || File(directory, "$key.partial.pb").isFile) {
        return "saved"
      }
      // Never replace a more recent trace with an older platform-history entry.
      val existing = files()
      if (existing.size >= MAX_TRACES && timestamp < existing.last().name.substringBefore('_').toLong()) {
        return "outside_retention"
      }
      if (!directory.exists() && !directory.mkdirs()) return "unavailable"
      val input = open() ?: return "unavailable"
      val temporary = File(directory, "$key.tmp")
      try {
        var count = 0
        var truncated = false
        input.use { source ->
          FileOutputStream(temporary).use { output ->
            val buffer = ByteArray(8192)
            while (count < MAX_TRACE_BYTES) {
              val read = source.read(buffer, 0, minOf(buffer.size, MAX_TRACE_BYTES - count))
              if (read < 0) break
              if (read == 0) throw java.io.IOException("Non-progressing trace stream")
              output.write(buffer, 0, read)
              count += read
            }
            if (count == MAX_TRACE_BYTES) truncated = source.read() != -1
            output.flush()
            output.fd.sync()
          }
        }
        if (count == 0) return "unavailable"
        val target = File(directory, "$key${if (truncated) ".partial" else ""}.pb")
        if (!temporary.renameTo(target)) return "unavailable"
        prune(now)
        if (truncated) "saved_truncated" else "saved"
      } finally {
        temporary.delete()
      }
    } catch (_: Exception) {
      // Missing, expired, inaccessible, and vendor-failing streams must not break the app.
      "unavailable"
    }
  }

  @Synchronized
  fun snapshot(now: Long): List<Trace> {
    return try {
      prune(now)
      files().mapNotNull { file ->
        try {
          val fields = file.name.split('_')
          // Files exceeding our bound are deleted by prune; still bound reads defensively.
          val bytes = file.inputStream().use { it.readNBytesCompat(MAX_TRACE_BYTES) }
          Trace(fields[0].toLong(), fields[1].toInt(), bytes, file.name.endsWith(".partial.pb"))
        } catch (_: Exception) { null }
      }
    } catch (_: Exception) { emptyList() }
  }

  private fun InputStream.readNBytesCompat(limit: Int): ByteArray {
    val output = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(8192)
    while (output.size() < limit) {
      val read = read(buffer, 0, minOf(buffer.size, limit - output.size()))
      if (read < 0) break
      if (read == 0) throw java.io.IOException("Non-progressing trace file")
      output.write(buffer, 0, read)
    }
    return output.toByteArray()
  }

  private fun eligibleTimestamp(timestamp: Long, now: Long): Boolean =
    timestamp > 0 && timestamp <= now && now - timestamp <= MAX_AGE_MS

  private fun key(timestamp: Long, pid: Int, processName: String): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(processName.toByteArray(Charsets.UTF_8))
      .take(8).joinToString("") { "%02x".format(it.toInt() and 255) }
    return "${timestamp}_${pid}_$digest"
  }

  private fun files(): List<File> = directory.listFiles().orEmpty()
    .filter { it.isFile && FILE_PATTERN.matches(it.name) }
    .sortedWith(compareByDescending<File> { it.name.substringBefore('_').toLong() }.thenBy { it.name })

  private fun prune(now: Long) {
    directory.listFiles().orEmpty().forEach { file ->
      val match = FILE_PATTERN.matchEntire(file.name)
      if (file.isFile && (match == null || !eligibleTimestamp(match.groupValues[1].toLongOrNull() ?: 0, now)
          || file.length() <= 0 || file.length() > MAX_TRACE_BYTES)) {
        file.delete()
      }
    }
    files().drop(MAX_TRACES).forEach { it.delete() }
  }

  companion object {
    const val MAX_TRACE_BYTES = 128 * 1024
    const val MAX_TRACES = 3
    const val MAX_AGE_MS = 7L * 24 * 60 * 60 * 1000
    private val FILE_PATTERN = Regex("([0-9]{1,19})_([0-9]{1,10})_[a-f0-9]{16}(?:\\.partial)?\\.pb")
  }
}
