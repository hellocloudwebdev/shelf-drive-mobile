package com.hellocloudweb.shelfdrive

import android.webkit.WebView

/**
 * Android-only suppression of WebView page scaling; desktop zoom remains untouched.
 *
 * `setSupportZoom(false)` alone is not enough: Chromium still runs its own
 * pinch/gesture handling on some device + WebView combinations, which makes the
 * app UI drift under a two-finger gesture. Disabling the built-in controls plus
 * the zoom support covers both the Android zoom API and the gesture detector.
 * A JS/CSS guard in the web bundle covers the remaining cases.
 */
internal object AndroidWebViewZoomPolicy {
  fun apply(webView: WebView) {
    webView.settings.apply {
      setSupportZoom(false)
      builtInZoomControls = false
      displayZoomControls = false
      setSupportMultipleWindows(false)
      textZoom = 100
    }
    webView.isHorizontalScrollBarEnabled = false
    webView.overScrollMode = android.view.View.OVER_SCROLL_NEVER
  }
}
