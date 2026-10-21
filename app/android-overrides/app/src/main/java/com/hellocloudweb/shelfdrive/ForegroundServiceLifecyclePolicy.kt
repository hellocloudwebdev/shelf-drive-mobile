package com.hellocloudweb.shelfdrive

/**
 * Serializes requests for one started foreground service across callers and the
 * service main thread. A stop token only stops the generation it was issued for.
 */
internal class ForegroundServiceLifecyclePolicy {
  private var latestGeneration = 0L
  private var requestedGeneration: Long? = null

  @Synchronized
  fun requestStart(): Long {
    requestedGeneration?.let { return it }
    latestGeneration += 1
    requestedGeneration = latestGeneration
    return latestGeneration
  }

  @Synchronized
  fun requestStop(): Long? {
    val generation = requestedGeneration ?: return null
    requestedGeneration = null
    return generation
  }

  @Synchronized
  fun onStartRequestFailed(generation: Long) {
    if (generation == latestGeneration && requestedGeneration == generation) {
      requestedGeneration = null
    }
  }

  @Synchronized
  fun onStopRequestFailed(generation: Long) {
    if (generation == latestGeneration && requestedGeneration == null) {
      requestedGeneration = generation
    }
  }

  /** Return the onCreate token without reviving a generation whose stop is already queued. */
  @Synchronized
  fun onServiceCreated(): Long {
    requestedGeneration?.let { return it }
    if (latestGeneration == 0L) return requestStart()
    // A stop may already have cleared the request while the original FGS start
    // is still waiting for onCreate; do not mistake that pending stop for a new run.
    return latestGeneration
  }

  @Synchronized
  fun onUntrackedServiceStart(): Long = requestStart()

  /** Run the stop operation while start requests are excluded by this policy's lock. */
  @Synchronized
  fun stopIfCurrent(generation: Long, stop: () -> Unit): Boolean {
    if (generation != latestGeneration) return false
    stop()
    return true
  }

  @Synchronized
  fun onServiceDestroyed(generation: Long) {
    if (generation == latestGeneration) requestedGeneration = null
  }
}
