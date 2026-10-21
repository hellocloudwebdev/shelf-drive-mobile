package com.hellocloudweb.shelfdrive

import android.webkit.JavascriptInterface
import androidx.annotation.Keep
import java.util.concurrent.Executors

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
    private val ipcExecutor = Executors.newCachedThreadPool { runnable ->
      Thread(null, runnable, "TauriIpcWorker", 2 * 1024 * 1024).apply {
        isDaemon = true
      }
    }
  }

  @JavascriptInterface
  fun postMessage(message: String?) {
    message?.let { m ->
      val webViewId = webView.id
      val currentUrl = webViewClient.currentUrl
      ipcExecutor.execute {
        Rust.ipc(webViewId, currentUrl, m)
      }
    }
  }
}
