package com.hellocloudweb.shelfdrive

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** Standalone policy checks; compile and run with app/scripts/test-foreground-service-lifecycle.sh. */
object ForegroundServiceLifecycleJvmChecks {
  private var assertions = 0

  @JvmStatic
  fun main(args: Array<String>) {
    val checks = listOf(
      "idle stop does not start a foreground service" to ::idleStopDoesNotStartForegroundService,
      "duplicate pending stops remain terminal and idempotent" to ::duplicatePendingStops,
      "start allocation and actual dispatch are serialized against stop" to ::allocationAndDispatchAreSerialized,
      "late stopped starts cannot revive a generation" to ::lateStartCannotRevive,
      "stale stop and destroy cannot affect a newer generation" to ::staleCallbacksCannotAffectNewerGeneration,
      "start dispatch failure rolls back without blocking a later generation" to ::startDispatchFailure,
      "running stop dispatch failure remains retryable" to ::stopDispatchFailure,
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
    if (failures.isNotEmpty()) throw AssertionError("${failures.size} failed: ${failures.joinToString("; ")}")
    println("OK: ${checks.size} checks, $assertions assertions")
  }

  private fun idleStopDoesNotStartForegroundService() {
    val policy = ForegroundServiceLifecyclePolicy()
    var idleStops = 0
    var runningStops = 0
    var fgsStarts = 0
    policy.stopAndDispatch(idleStop = { idleStops++ }, runningStop = { runningStops++ })
    equal(1, idleStops)
    equal(0, runningStops)
    equal(0, fgsStarts)

    val generation = policy.startAndDispatch { fgsStarts++ }
    equal(1, fgsStarts)
    policy.stopAndDispatch(idleStop = { idleStops++ }, runningStop = { runningStops++ })
    equal(1, fgsStarts) // startup stop marked terminal; it did not request another FGS start
    equal(0, runningStops) // pending startup is never canceled through a direct service stop
    equal(ForegroundServiceLifecyclePolicy.StartDisposition.STOP_TERMINAL, policy.onStartCommand(generation))
  }

  private fun duplicatePendingStops() {
    val policy = ForegroundServiceLifecyclePolicy()
    var starts = 0
    var stops = 0
    val generation = policy.startAndDispatch { starts++ }
    policy.stopAndDispatch(idleStop = { stops++ }, runningStop = { stops++ })
    policy.stopAndDispatch(idleStop = { stops++ }, runningStop = { stops++ })
    equal(1, starts)
    equal(0, stops)
    equal(ForegroundServiceLifecyclePolicy.StartDisposition.STOP_TERMINAL, policy.onStartCommand(generation))
    equal(ForegroundServiceLifecyclePolicy.StartDisposition.STOP_TERMINAL, policy.onStartCommand(generation))
    policy.onServiceDestroyed(generation)
    equal(ForegroundServiceLifecyclePolicy.StartDisposition.STOP_TERMINAL, policy.onStartCommand(generation))
    var terminalCleanup = 0
    check(policy.stopIfNotSuperseded(generation) { terminalCleanup++ }) { "terminal generation was not cleaned up" }
    equal(1, terminalCleanup)
  }

  private fun allocationAndDispatchAreSerialized() {
    val policy = ForegroundServiceLifecyclePolicy()
    val startEntered = CountDownLatch(1)
    val allowStartReturn = CountDownLatch(1)
    val stopAttempted = CountDownLatch(1)
    val stopFinished = CountDownLatch(1)
    val events = mutableListOf<String>()
    val startFailure = AtomicReference<Throwable?>()
    val startThread = Thread {
      try {
        policy.startAndDispatch { token ->
          synchronized(events) { events += "start-enter-$token" }
          startEntered.countDown()
          await(allowStartReturn, "start dispatcher was not released")
          synchronized(events) { events += "start-return-$token" }
        }
      } catch (failure: Throwable) { startFailure.set(failure) }
    }
    startThread.start()
    await(startEntered, "start dispatch did not enter")
    val stopThread = Thread {
      stopAttempted.countDown()
      policy.stopAndDispatch(
        idleStop = { synchronized(events) { events += "idle-stop" } },
        runningStop = { synchronized(events) { events += "running-stop-$it" } },
      )
      stopFinished.countDown()
    }
    stopThread.start()
    await(stopAttempted, "stop thread did not attempt lifecycle entry")
    check(!stopFinished.await(100, TimeUnit.MILLISECONDS)) { "stop overtook the in-progress start binder submission" }
    allowStartReturn.countDown()
    await(stopFinished, "stop did not proceed after start submission completed")
    startThread.join(1_000)
    stopThread.join(1_000)
    startFailure.get()?.let { throw it }
    equal(listOf("start-enter-1", "start-return-1"), synchronized(events) { events.toList() })
    equal(ForegroundServiceLifecyclePolicy.StartDisposition.STOP_TERMINAL, policy.onStartCommand(1L))
  }

  private fun lateStartCannotRevive() {
    val policy = ForegroundServiceLifecyclePolicy()
    val stopped = policy.startAndDispatch {}
    policy.stopAndDispatch(idleStop = {}, runningStop = {})
    equal(ForegroundServiceLifecyclePolicy.StartDisposition.STOP_TERMINAL, policy.onStartCommand(stopped))

    val newer = policy.startAndDispatch {}
    check(newer > stopped) { "start after terminal stop must allocate a new generation" }
    equal(ForegroundServiceLifecyclePolicy.StartDisposition.IGNORE_STALE, policy.onStartCommand(stopped))
    equal(ForegroundServiceLifecyclePolicy.StartDisposition.PROCESS, policy.onStartCommand(newer))
  }

  private fun staleCallbacksCannotAffectNewerGeneration() {
    val policy = ForegroundServiceLifecyclePolicy()
    val old = policy.startAndDispatch {}
    equal(ForegroundServiceLifecyclePolicy.StartDisposition.PROCESS, policy.onStartCommand(old))
    policy.stopAndDispatch(idleStop = {}, runningStop = {})
    val newer = policy.startAndDispatch {}
    equal(ForegroundServiceLifecyclePolicy.StartDisposition.IGNORE_STALE, policy.onStartCommand(old))
    policy.onServiceDestroyed(old)
    var staleCleanup = 0
    check(!policy.stopIfNotSuperseded(old) { staleCleanup++ }) { "stale cleanup ran over a newer pending generation" }
    equal(0, staleCleanup)
    equal(ForegroundServiceLifecyclePolicy.StartDisposition.PROCESS, policy.onStartCommand(newer))
    policy.stopAndDispatch(idleStop = {}, runningStop = {})
    equal(ForegroundServiceLifecyclePolicy.StartDisposition.STOP_TERMINAL, policy.onStartCommand(newer))
  }

  private fun startDispatchFailure() {
    val policy = ForegroundServiceLifecyclePolicy()
    val failed = try {
      policy.startAndDispatch { throw IllegalStateException("expected start dispatch failure") }
      throw AssertionError("dispatch failure was swallowed")
    } catch (expected: IllegalStateException) {
      // Distinguish our assertion above from the injected dispatch exception.
      if (expected.message == "dispatch failure was swallowed") throw expected
      1L
    }
    equal(ForegroundServiceLifecyclePolicy.StartDisposition.STOP_TERMINAL, policy.onStartCommand(failed))
    var starts = 0
    val retry = policy.startAndDispatch { starts++ }
    check(retry > failed) { "retry must not reuse a generation that may have a delayed callback" }
    equal(1, starts)
    equal(ForegroundServiceLifecyclePolicy.StartDisposition.IGNORE_STALE, policy.onStartCommand(failed))
    var staleCleanup = 0
    check(!policy.stopIfNotSuperseded(failed) { staleCleanup++ }) { "failed-generation cleanup overrode a newer pending start" }
    equal(0, staleCleanup)
    equal(ForegroundServiceLifecyclePolicy.StartDisposition.PROCESS, policy.onStartCommand(retry))
  }

  private fun stopDispatchFailure() {
    val policy = ForegroundServiceLifecyclePolicy()
    val running = policy.startAndDispatch {}
    equal(ForegroundServiceLifecyclePolicy.StartDisposition.PROCESS, policy.onStartCommand(running))
    try {
      policy.stopAndDispatch(idleStop = {}, runningStop = { throw IllegalStateException("expected stop failure") })
      throw AssertionError("stop dispatch failure was swallowed")
    } catch (expected: IllegalStateException) {
      if (expected.message == "stop dispatch failure was swallowed") throw expected
    }
    var retries = 0
    policy.stopAndDispatch(idleStop = {}, runningStop = { retries++ })
    equal(1, retries)
    equal(ForegroundServiceLifecyclePolicy.StartDisposition.STOP_TERMINAL, policy.onStartCommand(running))
  }

  private fun await(latch: CountDownLatch, message: String) {
    check(latch.await(3, TimeUnit.SECONDS)) { message }
  }

  private fun equal(expected: Any?, actual: Any?) {
    assertions++
    check(expected == actual) { "expected <$expected>, got <$actual>" }
  }
}
