package com.hellocloudweb.shelfdrive

import android.app.job.JobInfo
import androidx.work.NetworkType

/** Keeps OS-scheduled transfer work aligned with the user's Android network policy. */
internal object TransferNetworkPolicy {
  fun workManagerNetworkType(wifiOnly: Boolean, allowRoaming: Boolean): NetworkType = when {
    wifiOnly -> NetworkType.UNMETERED
    allowRoaming -> NetworkType.CONNECTED
    else -> NetworkType.NOT_ROAMING
  }

  fun jobSchedulerNetworkType(wifiOnly: Boolean, allowRoaming: Boolean): Int = when {
    wifiOnly -> JobInfo.NETWORK_TYPE_UNMETERED
    allowRoaming -> JobInfo.NETWORK_TYPE_ANY
    else -> JobInfo.NETWORK_TYPE_NOT_ROAMING
  }
}
