package com.hellocloudweb.shelfdrive

/** No new permissions, broad package queries, logcat, or filesystem tombstone access. */
internal object NativeExitTracePolicy {
  fun canCapture(sdk: Int, packageName: String, processName: String, realUid: Int,
                 packageUid: Int, ownUid: Int, reason: Int): Boolean =
    sdk >= 31 && realUid == ownUid && packageUid == ownUid && reason == 5 &&
      (processName == packageName || processName.startsWith("$packageName:"))
}
