package com.hellocloudweb.shelfdrive

import android.webkit.WebView

/** Android-only suppression of WebView page scaling; desktop zoom remains untouched. */
internal object AndroidWebViewZoomPolicy {
  fun apply(webView: WebView) {
    webView.settings.apply {
      setSupportZoom(false)
      builtInZoomControls = false
      displayZoomControls = false
    }
  }
}
