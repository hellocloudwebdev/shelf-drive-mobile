package com.hellocloudweb.shelfdrive

/** Safe construction of the error callback used when native IPC cannot dispatch a request. */
internal object IpcErrorCallback {
  const val REJECTION_MESSAGE = "IPC request rejected"
  private const val MAX_UNSIGNED_32 = 4_294_967_295L

  /** Accept only numeric, integral callback IDs representable by Tauri's unsigned-32-bit IDs. */
  fun callbackId(value: Any?): Long? {
    if (value !is Number) return null
    val numeric = value.toDouble()
    if (!numeric.isFinite() || numeric < 0.0 || numeric > MAX_UNSIGNED_32.toDouble()) return null
    if (numeric % 1.0 != 0.0) return null
    return numeric.toLong()
  }

  /** ID is range-checked again here so callers cannot inject JavaScript into the generated code. */
  fun rejectionScript(callbackId: Long): String {
    require(callbackId in 0L..MAX_UNSIGNED_32) { "Invalid Tauri error callback ID" }
    return "window.__TAURI_INTERNALS__.runCallback($callbackId, \"$REJECTION_MESSAGE\");"
  }
}
