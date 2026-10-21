package com.hellocloudweb.shelfdrive

/**
 * Serializes lifecycle state transitions together with the corresponding Android
 * dispatch. In particular, a stop cannot overtake a start submission, and a
 * stop during startup is recorded for onStartCommand rather than sent as a new
 * foreground-service request.
 */
internal class ForegroundServiceLifecyclePolicy {
  enum class StartDisposition { PROCESS, STOP_TERMINAL, IGNORE_STALE }

  private enum class Phase { IDLE, START_PENDING, RUNNING, TERMINAL_PENDING, STOPPING }

  private var latestGeneration = 0L
  private var phase = Phase.IDLE
  private var acceptedStartDispatch = false

  /** The dispatch callback runs under the same monitor as token allocation. */
  @Synchronized
  fun startAndDispatch(dispatch: (Long) -> Unit): Long {
    if (phase == Phase.IDLE || phase == Phase.TERMINAL_PENDING || phase == Phase.STOPPING) {
      latestGeneration += 1L
      phase = Phase.START_PENDING
      acceptedStartDispatch = false
    }
    val generation = latestGeneration
    try {
      dispatch(generation)
      acceptedStartDispatch = true
    } catch (failure: RuntimeException) {
      // A callback may still arrive despite a synchronous dispatch exception.
      // Keep this generation terminal so such a late start cannot revive it;
      // the next caller is free to allocate a strictly newer generation.
      if (generation == latestGeneration && phase == Phase.START_PENDING && !acceptedStartDispatch) {
        phase = Phase.TERMINAL_PENDING
      }
      throw failure
    }
    return generation
  }

  /**
   * Dispatch an ordinary stop only for an already-running instance. Startup
   * stops are terminal markers consumed by onStartCommand; idle stops use the
   * legacy harmless stopService path and never start a foreground service.
   */
  @Synchronized
  fun stopAndDispatch(idleStop: () -> Unit, runningStop: (Long) -> Unit) {
    when (phase) {
      Phase.IDLE -> idleStop()
      Phase.START_PENDING -> phase = Phase.TERMINAL_PENDING
      Phase.TERMINAL_PENDING, Phase.STOPPING -> Unit // duplicate stop is idempotent
      Phase.RUNNING -> {
        val generation = latestGeneration
        phase = Phase.STOPPING
        try {
          runningStop(generation)
        } catch (failure: RuntimeException) {
          if (generation == latestGeneration && phase == Phase.STOPPING) phase = Phase.RUNNING
          throw failure
        }
      }
    }
  }

  /** Validate a start command after onCreate has already promoted the service. */
  @Synchronized
  fun onStartCommand(generation: Long): StartDisposition {
    if (generation <= 0L) return StartDisposition.IGNORE_STALE
    if (generation != latestGeneration) return StartDisposition.IGNORE_STALE
    return when (phase) {
      Phase.START_PENDING -> {
        phase = Phase.RUNNING
        acceptedStartDispatch = true
        StartDisposition.PROCESS
      }
      Phase.RUNNING -> StartDisposition.PROCESS
      Phase.TERMINAL_PENDING -> StartDisposition.STOP_TERMINAL
      Phase.STOPPING -> StartDisposition.STOP_TERMINAL
      Phase.IDLE -> StartDisposition.STOP_TERMINAL
    }
  }

  /**
   * Run terminal cleanup while start dispatch is excluded. A delayed old start
   * may clean up an idle/terminal service, but cannot remove a newer active
   * generation's notification or stop that instance.
   */
  @Synchronized
  fun stopIfNotSuperseded(generation: Long, stop: () -> Unit): Boolean {
    if (latestGeneration > generation && (phase == Phase.START_PENDING || phase == Phase.RUNNING)) {
      return false
    }
    if (generation == latestGeneration && phase == Phase.TERMINAL_PENDING) phase = Phase.STOPPING
    stop()
    return true
  }

  /** Handle service starts not sent through this class's production API. */
  @Synchronized
  fun onUntrackedServiceStart(): Long {
    if (phase == Phase.IDLE || phase == Phase.TERMINAL_PENDING || phase == Phase.STOPPING) {
      latestGeneration += 1L
      phase = Phase.RUNNING
      acceptedStartDispatch = true
    } else if (phase == Phase.START_PENDING) {
      phase = Phase.RUNNING
      acceptedStartDispatch = true
    }
    return latestGeneration
  }

  /** Only the instance that still owns the generation may clear its state. */
  @Synchronized
  fun onServiceDestroyed(generation: Long) {
    if (generation != latestGeneration) return
    when (phase) {
      Phase.STOPPING, Phase.RUNNING -> {
        phase = Phase.IDLE
        acceptedStartDispatch = false
      }
      // Do not clear a terminal startup token: an already-queued start command
      // must still be recognized as terminal, not as a fresh generation.
      Phase.IDLE, Phase.START_PENDING, Phase.TERMINAL_PENDING -> Unit
    }
  }
}
