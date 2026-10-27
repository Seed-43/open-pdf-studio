// Android activity of Open PDF Studio (#596).
//
// `tauri android init` generates src-tauri/gen/android (not in git) with a
// bare MainActivity. scripts/android-project.mjs replaces that file with this
// one after init, locally and in the release workflow.
//
// 1. System bars: the activity runs edge-to-edge (enforced from targetSdk 35
//    on Android 15, and switched on by enableEdgeToEdge() below for older
//    versions). The WebView then reaches under the status bar and the
//    navigation bar, and env(safe-area-inset-*) stays 0 in the WebView, so
//    the app's top and bottom bars were drawn under them (tapping zoom-in hit
//    Home). The content view gets the system bar, display cutout and keyboard
//    insets as padding, so the WebView only covers the free area.
// 2. File names: a document opened from another app or the file picker is a
//    content:// URI with an opaque id. window.OpdsAndroid.displayName(uri)
//    returns its display name (OpenableColumns.DISPLAY_NAME), see
//    js/core/bestandsnaam.js.

package org.openaec.openpdfstudio

import android.app.Activity
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
      WindowInsetsCompat.CONSUMED
    }
    ViewCompat.requestApplyInsets(content)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.addJavascriptInterface(OpdsAndroidBridge(this), "OpdsAndroid")
  }
}

class OpdsAndroidBridge(private val activity: Activity) {
  @JavascriptInterface
  fun displayName(uri: String?): String? {
    if (uri == null || !uri.startsWith("content://")) return null
    return try {
      activity.contentResolver.query(
        Uri.parse(uri), arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null
      )?.use { cursor ->
        val column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (column >= 0 && cursor.moveToFirst() && !cursor.isNull(column)) cursor.getString(column) else null
      }
    } catch (e: Exception) {
      null
    }
  }
}
