package com.hellocloudweb.shelfdrive

import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.nio.file.Files
import java.util.Base64

/** Dependency-free host checks. Run with app/scripts/test-native-exit-traces.sh. */
object NativeExitTraceJvmChecks {
  private const val NOW = 1_800_000_000_000L
  private var assertions = 0

  @JvmStatic
  fun main(args: Array<String>) {
    val tests = listOf(
      "bounded capture and stream closure" to ::boundedCaptureAndClosure,
      "exact limit is complete, not truncated" to ::exactLimitIsComplete,
      "binary persistence across re-instantiation" to ::binaryPersistence,
      "newest-first max-three retention" to ::retention,
      "seven-day expiry on capture and read" to ::expiry,
      "deduplication avoids reopening" to ::deduplication,
      "bad streams leave no temporary files" to ::badStreams,
      "stream failures do not corrupt existing traces" to ::errorsDoNotCorrupt,
      "tampered oversized leftovers are removed" to ::tamperedOversizedLeftovers,
      "process names do not appear in filenames" to ::opaqueFilenames,
      "SDK and native-crash capture policy" to ::policy,
    )
    val failures = mutableListOf<String>()
    tests.forEach { (name, test) ->
      try {
        test()
        println("PASS $name")
      } catch (failure: Throwable) {
        failures += "$name: ${failure.message}"
        println("FAIL $name: ${failure.message}")
      }
    }
    if (failures.isNotEmpty()) throw AssertionError("${failures.size} failed: ${failures.joinToString("; ")}")
    println("OK: ${tests.size} checks, $assertions assertions")
  }

  private fun boundedCaptureAndClosure() = withStore { dir, store ->
    val source = CountingStream(NativeExitTraceStore.MAX_TRACE_BYTES + 1)
    equal("saved_truncated", store.capture(NOW, 41, "app", NOW) { source })
    equal(NativeExitTraceStore.MAX_TRACE_BYTES + 1, source.bytesDelivered)
    equal(1, source.closeCount)
    val trace = store.snapshot(NOW).single()
    equal(NativeExitTraceStore.MAX_TRACE_BYTES, trace.bytes.size)
    check(trace.truncated, "extra source byte must be represented by truncated=true")
  }

  private fun exactLimitIsComplete() = withStore { _, store ->
    val source = CountingStream(NativeExitTraceStore.MAX_TRACE_BYTES)
    equal("saved", store.capture(NOW, 42, "exact-limit", NOW) { source })
    equal(NativeExitTraceStore.MAX_TRACE_BYTES, source.bytesDelivered)
    equal(1, source.closeCount)
    val trace = store.snapshot(NOW).single()
    equal(NativeExitTraceStore.MAX_TRACE_BYTES, trace.bytes.size)
    check(!trace.truncated, "exact limit followed by EOF is not truncated")
  }

  private fun binaryPersistence() = withStore { dir, store ->
    val bytes = byteArrayOf(0, 1, -1, 0x55, 0x7f, -128, 42, 0, 13)
    equal("saved", store.capture(NOW - 11, 7, "app:worker", NOW) { ByteArrayInputStream(bytes) })
    val expectedBase64 = Base64.getEncoder().encodeToString(bytes)
    val restarted = NativeExitTraceStore(dir)
    val actual = restarted.snapshot(NOW).single()
    equal(expectedBase64, Base64.getEncoder().encodeToString(actual.bytes))
    equal(NOW - 11, actual.timestamp)
    equal(7, actual.pid)
    check(!actual.truncated, "small trace should not be marked truncated")
  }

  private fun retention() = withStore { _, store ->
    for (offset in 4L downTo 1L) {
      equal("saved", store.capture(NOW - offset, offset.toInt(), "app", NOW) {
        ByteArrayInputStream(byteArrayOf(offset.toByte()))
      })
    }
    val traces = store.snapshot(NOW)
    equal(listOf(NOW - 1, NOW - 2, NOW - 3), traces.map { it.timestamp })
    equal(listOf(1, 2, 3), traces.map { it.pid })
    equal("outside_retention", store.capture(NOW - 5, 5, "stale-history", NOW) {
      fail("old platform history must not evict the newest retained traces")
    })
    equal(listOf(NOW - 1, NOW - 2, NOW - 3), store.snapshot(NOW).map { it.timestamp })
  }

  private fun expiry() = withStore { dir, store ->
    val exactlySevenDaysOld = NOW - NativeExitTraceStore.MAX_AGE_MS
    equal("saved", store.capture(exactlySevenDaysOld, 2, "boundary", NOW) {
      ByteArrayInputStream(byteArrayOf(9))
    })
    equal(1, store.snapshot(NOW).size)
    val tooOld = NOW - NativeExitTraceStore.MAX_AGE_MS - 1
    equal("outside_retention", store.capture(tooOld, 3, "old", NOW) {
      fail("expired capture must not open its stream")
    })
    equal("outside_retention", store.capture(NOW + 1, 4, "future", NOW) {
      fail("future capture must not open its stream")
    })
    equal(1, NativeExitTraceStore(dir).snapshot(NOW).size)
    equal(1, dir.listFiles().orEmpty().count { it.name.endsWith(".pb") })
    equal(1, store.snapshot(NOW).size)
    // The exact boundary remains valid; a snapshot one millisecond later expires it.
    equal(0, store.snapshot(NOW + 1).size)
  }

  private fun deduplication() = withStore { _, store ->
    val payload = byteArrayOf(4, 5, 6)
    equal("saved", store.capture(NOW, 9, "app:service", NOW) { ByteArrayInputStream(payload) })
    var opens = 0
    equal("saved", store.capture(NOW, 9, "app:service", NOW) {
      opens++
      fail("duplicate trace must not reopen stream")
    })
    equal(0, opens)
    equal(1, store.snapshot(NOW).size)
  }

  private fun badStreams() = withStore { dir, store ->
    equal("unavailable", store.capture(NOW, 1, "null", NOW) { null })
    equal("saved", store.capture(NOW, 1, "null", NOW) { ByteArrayInputStream(byteArrayOf(1)) })
    equal("unavailable", store.capture(NOW, 2, "throw", NOW) { throw IOException("vendor error") })
    var emptyClosed = false
    val empty = object : ByteArrayInputStream(byteArrayOf()) {
      override fun close() { emptyClosed = true; super.close() }
    }
    equal("unavailable", store.capture(NOW, 3, "empty", NOW) { empty })
    check(emptyClosed, "empty stream must be closed")
    val zeroRead = object : InputStream() {
      var closed = false
      override fun read(): Int = 0
      override fun read(b: ByteArray, off: Int, len: Int): Int = 0
      override fun close() { closed = true }
    }
    equal("unavailable", store.capture(NOW, 4, "zero", NOW) { zeroRead })
    check(zeroRead.closed, "zero-progress stream must be closed")
    equal(1, store.snapshot(NOW).size)
    check(dir.listFiles().orEmpty().none { it.name.endsWith(".tmp") },
      "failed/empty captures must not leave temporary files")
  }

  private fun errorsDoNotCorrupt() = withStore { dir, store ->
    val original = byteArrayOf(11, 22, 33)
    equal("saved", store.capture(NOW, 1, "good", NOW) { ByteArrayInputStream(original) })
    val bad = object : InputStream() {
      var delivered = false
      override fun read(): Int {
        if (!delivered) { delivered = true; return 99 }
        throw IOException("broken stream")
      }
      override fun read(b: ByteArray, off: Int, len: Int): Int {
        if (delivered) throw IOException("broken stream")
        delivered = true
        b[off] = 99
        return 1
      }
    }
    equal("unavailable", store.capture(NOW - 1, 2, "broken", NOW) { bad })
    val traces = NativeExitTraceStore(dir).snapshot(NOW)
    equal(1, traces.size)
    equal(original.toList(), traces.single().bytes.toList())
    val persisted = dir.listFiles().orEmpty().filter { it.name.endsWith(".pb") }
    equal(1, persisted.size)
    check(persisted.single().name.startsWith("${NOW}_1_"), "original trace file must remain intact")
    check(dir.listFiles().orEmpty().none { it.name.endsWith(".tmp") }, "exception path must clean temp")
  }

  private fun tamperedOversizedLeftovers() = withStore { dir, store ->
    val tampered = File(dir, "${NOW}_12_0123456789abcdef.pb")
    tampered.writeBytes(ByteArray(NativeExitTraceStore.MAX_TRACE_BYTES + 1) { 1 })
    val malformed = File(dir, "not-a-trace.pb")
    malformed.writeBytes(byteArrayOf(1))
    equal(emptyList<NativeExitTraceStore.Trace>(), store.snapshot(NOW))
    check(!tampered.exists(), "oversized matching trace must be removed")
    check(!malformed.exists(), "unrecognized leftover must be removed")
  }

  private fun opaqueFilenames() = withStore { dir, store ->
    val pathLike = "../../private/very-sensitive-process-name"
    equal("saved", store.capture(NOW, 55, pathLike, NOW) { ByteArrayInputStream(byteArrayOf(8)) })
    val names = dir.listFiles().orEmpty().map { it.name }
    equal(1, names.size)
    check(names.single().contains("_55_"), "filename should retain numeric identity fields")
    check(!names.single().contains("private") && !names.single().contains("sensitive") &&
      !names.single().contains("process-name"), "raw process name must not leak into filename")
  }

  private fun policy() {
    val packageName = "com.example.app"
    for (sdk in 31..36) {
      check(NativeExitTracePolicy.canCapture(sdk, packageName, packageName, 1001, 1001, 1001, 5),
        "SDK $sdk should capture own main process native crash")
      check(NativeExitTracePolicy.canCapture(sdk, packageName, "$packageName:worker", 1001, 1001, 1001, 5),
        "SDK $sdk should capture own subprocess native crash")
    }
    check(!NativeExitTracePolicy.canCapture(30, packageName, packageName, 1001, 1001, 1001, 5),
      "SDK below 31 must be rejected")
    check(!NativeExitTracePolicy.canCapture(36, packageName, "com.other.app", 1001, 1001, 1001, 5),
      "other app process must be rejected")
    check(!NativeExitTracePolicy.canCapture(36, packageName, "$packageName.evil", 1001, 1001, 1001, 5),
      "prefix without colon must be rejected")
    check(!NativeExitTracePolicy.canCapture(36, packageName, packageName, 2002, 1001, 1001, 5),
      "foreign real UID must be rejected")
    check(!NativeExitTracePolicy.canCapture(36, packageName, packageName, 1001, 2002, 1001, 5),
      "foreign package UID must be rejected")
    check(!NativeExitTracePolicy.canCapture(36, packageName, packageName, 1001, 1001, 2002, 5),
      "non-own process UID must be rejected")
    for (reason in listOf(0, 1, 2, 3, 4, 6, 7, 8)) {
      check(!NativeExitTracePolicy.canCapture(36, packageName, packageName, 1001, 1001, 1001, reason),
        "non-native reason $reason must be rejected")
    }
  }

  private class CountingStream(private val total: Int) : InputStream() {
    var bytesDelivered = 0
      private set
    var closeCount = 0
      private set
    override fun read(): Int {
      if (bytesDelivered >= total) return -1
      bytesDelivered++
      return (bytesDelivered and 0xff)
    }
    override fun read(b: ByteArray, off: Int, len: Int): Int {
      if (bytesDelivered >= total) return -1
      val amount = minOf(len, total - bytesDelivered)
      repeat(amount) { b[off + it] = ((bytesDelivered + it + 1) and 0xff).toByte() }
      bytesDelivered += amount
      return amount
    }
    override fun close() { closeCount++ }
  }

  private inline fun withStore(block: (File, NativeExitTraceStore) -> Unit) {
    val dir = Files.createTempDirectory("native-exit-traces-").toFile()
    try { block(dir, NativeExitTraceStore(dir)) } finally { dir.deleteRecursively() }
  }

  private fun check(value: Boolean, message: String) {
    assertions++
    if (!value) throw AssertionError(message)
  }

  private fun <T> equal(expected: T, actual: T) {
    assertions++
    if (expected != actual) throw AssertionError("expected <$expected>, got <$actual>")
  }

  private fun fail(message: String): Nothing = throw AssertionError(message)
}
