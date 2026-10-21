package com.hellocloudweb.shelfdrive

import android.webkit.JavascriptInterface
import androidx.annotation.Keep
import android.util.Log
import org.json.JSONObject

/**
 * Android WebView JavaScript interface for Tauri IPC communication.
 *
 * WebView dispatches `@JavascriptInterface` invocations on a dedicated `JavaBridge`
 * thread whose stack size is bounded (~1 MB or less in Android Chromium).
 * Passing large IPC requests (e.g. file upload and transfer pipeline requests)
 * directly into Rust on this thread causes native stack overflows (SIGSEGV SEGV_ACCERR)
 * when Tauri deserializes and allocates command futures on the stack.
 *
 * Offloading `Rust.ipc` invocations to a dedicated worker thread pool with an explicit
 * 2 MB stack ensures IPC message handling never overflows the WebView's JavaBridge thread stack.
 */
@Keep
class Ipc(val webView: RustWebView, val webViewClient: RustWebViewClient) {
  companion object {
    private val ipcExecutor = BoundedIpcExecutor(
      onFailure = { failure -> Log.e("TauriIpc", "IPC dispatch failed: ${failure.javaClass.simpleName}", failure) },
    )

    /** Invalidate queued IPC work belonging to this exact WebView, without affecting a replacement. */
    fun closeForWebView(webView: android.webkit.WebView?) {
      val rustWebView = webView as? RustWebView ?: return
      ipcExecutor.closeClientsFor(rustWebView)
    }
  }

  private val client = ipcExecutor.openClient(webView)

  @JavascriptInterface
  fun postMessage(message: String?) {
    if (message == null) return
    val webViewId = webView.id
    val currentUrl = webViewClient.currentUrl
    val errorCallbackId = errorCallbackId(message) ?: run {
      Log.e("TauriIpc", "Malformed IPC envelope; error callback ID is not an unsigned 32-bit number")
      return
    }
    return when (ipcExecutor.submit(client) {
      try {
        Rust.ipc(webViewId, currentUrl, message)
      } catch (failure: Exception) {
        Log.e("TauriIpc", "IPC dispatch failed: ${failure.javaClass.simpleName}", failure)
        reject(errorCallbackId, currentUrl)
      }
    }) {
      BoundedIpcExecutor.Submission.ACCEPTED -> Unit
      BoundedIpcExecutor.Submission.CLOSED -> Unit
      BoundedIpcExecutor.Submission.OVERLOADED -> {
        Log.e("TauriIpc", "IPC queue full; rejecting request for WebView $webViewId")
        reject(errorCallbackId, currentUrl)
      }
    }
  }

  private fun errorCallbackId(message: String): Long? = try {
    IpcErrorCallback.callbackId(JSONObject(message).opt("error"))
  } catch (_: Exception) {
    null
  }

  private fun reject(errorCallbackId: Long, capturedUrl: String) {
    webView.post {
      if (!client.active || webViewClient.currentUrl != capturedUrl) return@post
      webView.evaluateJavascript(IpcErrorCallback.rejectionScript(errorCallbackId), null)
    }
  }
}
