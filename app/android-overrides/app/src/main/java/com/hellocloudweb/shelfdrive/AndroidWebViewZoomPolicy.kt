package com.hellocloudweb.shelfdrive

import android.webkit.WebView

/**
 * Android-only suppression of WebView page scaling; desktop zoom remains untouched.
 *
 * Disable the WebView page zoom API and built-in zoom controls while keeping
 * text scaling, scrolling, and other WebView settings under their existing
 * platform/user policy. A JS guard in the app bundle covers remaining gestures.
 */
internal object AndroidWebViewZoomPolicy {
  fun apply(webView: WebView) {
    webView.settings.apply {
      setSupportZoom(false)
      builtInZoomControls = false
      displayZoomControls = false
    }
  }
}
