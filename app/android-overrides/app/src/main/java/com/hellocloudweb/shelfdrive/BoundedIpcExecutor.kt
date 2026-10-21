package com.hellocloudweb.shelfdrive

import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadFactory
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Bounded host-side executor for IPC work that must not run on WebView's JavaBridge thread.
 * A lease identifies work owned by one WebView lifetime; invalidating a lease makes queued
 * work a no-op and removes it from the queue. Work already started cannot be safely cancelled.
 */
internal class BoundedIpcExecutor(
  private val maxWorkers: Int = DEFAULT_MAX_WORKERS,
  private val queueCapacity: Int = DEFAULT_QUEUE_CAPACITY,
  private val keepAliveMillis: Long = DEFAULT_KEEP_ALIVE_MILLIS,
  internal val workerStackSizeBytes: Long = WORKER_STACK_SIZE_BYTES,
  private val onFailure: (Exception) -> Unit = {},
) : AutoCloseable {
  internal enum class Submission { ACCEPTED, OVERLOADED, CLOSED }

  internal class Client internal constructor(
    internal val owner: BoundedIpcExecutor,
    internal val webViewOwner: Any,
  ) {
    @Volatile internal var active: Boolean = true
  }

  private inner class DispatchTask(
    val client: Client,
    val action: () -> Unit,
  ) : Runnable {
    override fun run() {
      // This is the linearization point between a task becoming in-flight and a lifecycle close.
      val shouldRun = synchronized(lifecycleLock) {
        !isShutdown && client.active && clients.contains(client)
      }
      if (!shouldRun) return
      try {
        action()
      } catch (failure: Exception) {
        try {
          onFailure(failure)
        } catch (_: Exception) {
          // A diagnostics callback must not kill the worker or hide later IPC dispatches.
        }
      }
    }
  }

  private val lifecycleLock = Any()
  private val clients = mutableSetOf<Client>()
  private var isShutdown = false
  private val threadIds = AtomicInteger()
  private val executor: ThreadPoolExecutor

  init {
    require(maxWorkers > 0) { "maxWorkers must be positive" }
    require(queueCapacity > 0) { "queueCapacity must be positive" }
    require(keepAliveMillis > 0) { "keepAliveMillis must be positive" }
    require(workerStackSizeBytes > 0) { "workerStackSizeBytes must be positive" }
    executor = ThreadPoolExecutor(
      maxWorkers,
      maxWorkers,
      keepAliveMillis,
      TimeUnit.MILLISECONDS,
      ArrayBlockingQueue(queueCapacity),
      ThreadFactory { runnable ->
        Thread(null, runnable, "TauriIpcWorker-${threadIds.incrementAndGet()}", workerStackSizeBytes)
          .apply { isDaemon = true }
      },
      ThreadPoolExecutor.AbortPolicy(),
    ).apply {
      // The fixed maximum bounds the 2 MiB stack reservations; timeout retires idle workers.
      allowCoreThreadTimeOut(true)
    }
  }

  internal fun openClient(webViewOwner: Any): Client = synchronized(lifecycleLock) {
    check(!isShutdown) { "IPC executor is shut down" }
    Client(this, webViewOwner).also(clients::add)
  }

  internal fun submit(client: Client, action: () -> Unit): Submission = synchronized(lifecycleLock) {
    if (isShutdown || client.owner !== this || !client.active || !clients.contains(client)) {
      return@synchronized Submission.CLOSED
    }
    try {
      executor.execute(DispatchTask(client, action))
      Submission.ACCEPTED
    } catch (_: RejectedExecutionException) {
      if (isShutdown || !client.active) Submission.CLOSED else Submission.OVERLOADED
    }
  }

  /** Invalidate all IPC leases for exactly one WebView object, preserving other live WebViews. */
  internal fun closeClientsFor(webViewOwner: Any) = synchronized(lifecycleLock) {
    val closing = clients.filter { it.webViewOwner === webViewOwner }
    closing.forEach { it.active = false }
    clients.removeAll(closing.toSet())
    removeQueuedTasks { queued -> closing.any { it === queued.client } }
  }

  /** Invalidate all currently registered WebView lifetimes; later WebViews receive fresh leases. */
  internal fun closeAllClients() = synchronized(lifecycleLock) {
    clients.forEach { it.active = false }
    clients.clear()
    removeQueuedTasks { true }
  }

  private fun removeQueuedTasks(predicate: (DispatchTask) -> Boolean) {
    executor.queue.toList().forEach { queued ->
      if (queued is DispatchTask && predicate(queued)) executor.remove(queued)
    }
  }

  internal fun queuedTaskCount(): Int = executor.queue.size
  internal fun workerCount(): Int = executor.poolSize

  /** Permanently stop this executor; intended for focused JVM tests and process teardown. */
  override fun close() = synchronized(lifecycleLock) {
    if (isShutdown) return@synchronized
    isShutdown = true
    clients.forEach { it.active = false }
    clients.clear()
    executor.shutdownNow()
  }

  internal companion object {
    const val DEFAULT_MAX_WORKERS = 2
    const val DEFAULT_QUEUE_CAPACITY = 16
    const val DEFAULT_KEEP_ALIVE_MILLIS = 30_000L
    const val WORKER_STACK_SIZE_BYTES = 2L * 1024L * 1024L
  }
}
