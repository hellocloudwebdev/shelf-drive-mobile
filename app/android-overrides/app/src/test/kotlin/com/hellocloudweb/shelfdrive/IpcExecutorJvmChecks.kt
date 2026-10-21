package com.hellocloudweb.shelfdrive

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** Dependency-free host checks. Run with app/scripts/test-ipc-executor.sh. */
object IpcExecutorJvmChecks {
  private var assertions = 0

  @JvmStatic
  fun main(args: Array<String>) {
    val checks = listOf(
      "worker, queue, and overload bounds" to ::workerQueueAndOverloadBounds,
      "Tauri rejection callback IDs are validated and safely encoded" to ::errorCallbackContract,
      "WebView close drops only its queued stale work" to ::closeDropsStaleWork,
      "task failures are reported and workers continue" to ::taskFailureIsReported,
      "idle workers retire" to ::idleWorkersRetire,
      "explicit worker stack reservation" to ::explicitWorkerStackReservation,
      "foreground service stop is serialized by generation" to ::foregroundServiceStopSerialization,
    )
    val failures = mutableListOf<String>()
    checks.forEach { (name, check) ->
      try {
        check()
        println("PASS $name")
      } catch (failure: Throwable) {
        failures += "$name: ${failure.message}"
        println("FAIL $name: ${failure.message}")
      }
    }
    if (failures.isNotEmpty()) {
      throw AssertionError("${failures.size} failed: ${failures.joinToString("; ")}")
    }
    println("OK: ${checks.size} checks, $assertions assertions")
  }

  private fun workerQueueAndOverloadBounds() {
    val pool = BoundedIpcExecutor(maxWorkers = 2, queueCapacity = 2, keepAliveMillis = 5_000)
    try {
      val client = pool.openClient(Any())
      val started = CountDownLatch(2)
      val release = CountDownLatch(1)
      val allDone = CountDownLatch(4)
      val running = AtomicInteger()
      val maximumRunning = AtomicInteger()
      fun work(block: Boolean) = {
        val nowRunning = running.incrementAndGet()
        maximumRunning.updateAndGet { current -> maxOf(current, nowRunning) }
        if (block) {
          started.countDown()
          await(release, "workers were not released")
        }
        running.decrementAndGet()
        allDone.countDown()
      }

      equal(BoundedIpcExecutor.Submission.ACCEPTED, pool.submit(client, work(true)))
      equal(BoundedIpcExecutor.Submission.ACCEPTED, pool.submit(client, work(true)))
      await(started, "two worker threads did not start")
      equal(BoundedIpcExecutor.Submission.ACCEPTED, pool.submit(client, work(false)))
      equal(BoundedIpcExecutor.Submission.ACCEPTED, pool.submit(client, work(false)))
      equal(2, pool.queuedTaskCount())
      equal(BoundedIpcExecutor.Submission.OVERLOADED, pool.submit(client, work(false)))
      equal(2, pool.workerCount())
      release.countDown()
      await(allDone, "accepted IPC work did not drain")
      equal(2, maximumRunning.get())
      equal(0, pool.queuedTaskCount())
    } finally {
      pool.close()
    }
  }

  private fun closeDropsStaleWork() {
    val pool = BoundedIpcExecutor(maxWorkers = 1, queueCapacity = 2, keepAliveMillis = 5_000)
    try {
      val oldWebView = Any()
      val siblingClient = pool.openClient(Any())
      val oldClient = pool.openClient(oldWebView)
      val started = CountDownLatch(1)
      val release = CountDownLatch(1)
      val staleRuns = AtomicInteger()
      val finished = CountDownLatch(1)
      val siblingRan = CountDownLatch(1)
      equal(BoundedIpcExecutor.Submission.ACCEPTED, pool.submit(oldClient) {
        started.countDown()
        await(release, "active task was not released")
        finished.countDown()
      })
      await(started, "active task did not start")
      equal(BoundedIpcExecutor.Submission.ACCEPTED, pool.submit(oldClient) { staleRuns.incrementAndGet() })
      equal(BoundedIpcExecutor.Submission.ACCEPTED, pool.submit(siblingClient) { siblingRan.countDown() })
      equal(2, pool.queuedTaskCount())

      pool.closeClientsFor(oldWebView)
      equal(1, pool.queuedTaskCount())
      equal(BoundedIpcExecutor.Submission.CLOSED, pool.submit(oldClient) { staleRuns.incrementAndGet() })

      // A replacement WebView gets a fresh lease; closing the old object leaves sibling work valid.
      val newClient = pool.openClient(Any())
      val freshRan = CountDownLatch(1)
      equal(BoundedIpcExecutor.Submission.ACCEPTED, pool.submit(newClient) { freshRan.countDown() })
      release.countDown()
      await(finished, "pre-close in-flight task did not finish")
      await(siblingRan, "closing one WebView cancelled a sibling's queued task")
      await(freshRan, "fresh WebView work did not run")
      equal(0, staleRuns.get())
    } finally {
      pool.close()
    }
  }

  private fun errorCallbackContract() {
    equal(0L, IpcErrorCallback.callbackId(0))
    equal(4_294_967_295L, IpcErrorCallback.callbackId(4_294_967_295L))
    equal(12L, IpcErrorCallback.callbackId(12.0))
    equal(null, IpcErrorCallback.callbackId(-1))
    equal(null, IpcErrorCallback.callbackId(4_294_967_296L))
    equal(null, IpcErrorCallback.callbackId(1.5))
    equal(null, IpcErrorCallback.callbackId("12);alert(1)//"))
    equal(null, IpcErrorCallback.callbackId(null))

    val script = IpcErrorCallback.rejectionScript(23L)
    equal(
      "window.__TAURI_INTERNALS__.runCallback(23, \"IPC request rejected\");",
      script,
    )
    check(!script.contains("payload") && !script.contains("cmd")) {
      "rejection script must not include request payload or command"
    }
  }

  private fun taskFailureIsReported() {
    val reported = CountDownLatch(1)
    val succeeded = CountDownLatch(1)
    val pool = BoundedIpcExecutor(maxWorkers = 1, queueCapacity = 1, onFailure = { reported.countDown() })
    try {
      val client = pool.openClient(Any())
      equal(BoundedIpcExecutor.Submission.ACCEPTED, pool.submit(client) { throw IllegalStateException("expected test failure") })
      equal(BoundedIpcExecutor.Submission.ACCEPTED, pool.submit(client) { succeeded.countDown() })
      await(reported, "task exception was not reported")
      await(succeeded, "worker did not continue after task failure")
    } finally {
      pool.close()
    }
  }

  private fun idleWorkersRetire() {
    val pool = BoundedIpcExecutor(maxWorkers = 1, queueCapacity = 1, keepAliveMillis = 40)
    try {
      val client = pool.openClient(Any())
      val ran = CountDownLatch(1)
      equal(BoundedIpcExecutor.Submission.ACCEPTED, pool.submit(client) { ran.countDown() })
      await(ran, "retirement test task did not run")
      eventually("idle worker did not retire") { pool.workerCount() == 0 }
    } finally {
      pool.close()
    }
  }

  private fun explicitWorkerStackReservation() {
    equal(2L * 1024L * 1024L, BoundedIpcExecutor.WORKER_STACK_SIZE_BYTES)
    equal(2, BoundedIpcExecutor.DEFAULT_MAX_WORKERS)
  }

  private fun foregroundServiceStopSerialization() {
    val policy = ForegroundServiceLifecyclePolicy()
    equal(null, policy.requestStop()) // Idle stop must not request a new service start.

    val pendingStart = policy.requestStart()
    equal(pendingStart, policy.requestStart()) // Updates join the pending generation.
    val stopToken = policy.requestStop()
    equal(pendingStart, stopToken)
    equal(pendingStart, policy.onServiceCreated()) // The delayed onCreate must not revive it.
    var stops = 0
    check(policy.stopIfCurrent(stopToken!!) { stops++ }) { "current generation stop was rejected" }
    equal(1, stops)

    val newerStart = policy.requestStart()
    check(newerStart > pendingStart) { "a later start must receive a newer generation" }
    check(!policy.stopIfCurrent(stopToken) { stops++ }) { "stale stop shut down a newer generation" }
    equal(1, stops)

    policy.onStartRequestFailed(newerStart)
    equal(null, policy.requestStop()) // failed start must not leave a phantom service request

    val running = policy.onUntrackedServiceStart()
    equal(running, policy.requestStop())
    policy.onStopRequestFailed(running)
    equal(running, policy.requestStop()) // a rejected stop remains retryable
  }

  private fun await(latch: CountDownLatch, message: String) {
    check(latch.await(3, TimeUnit.SECONDS)) { message }
  }

  private fun eventually(message: String, predicate: () -> Boolean) {
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3)
    while (System.nanoTime() < deadline) {
      if (predicate()) return
      Thread.sleep(10)
    }
    check(predicate()) { message }
  }

  private fun equal(expected: Any?, actual: Any?) {
    assertions++
    check(expected == actual) { "expected <$expected>, got <$actual>" }
  }
}
