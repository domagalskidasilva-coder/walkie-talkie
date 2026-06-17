package com.radio.walkietalkie

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

// MainActivity customizada para o walkie-talkie.
//
// No Android, `getUserMedia` no WebView só funciona se:
//  1) a permissão RECORD_AUDIO for concedida em runtime; e
//  2) o WebChromeClient responder ao onPermissionRequest concedendo o microfone.
// O Tauri 2 não faz (2) sozinho, então tratamos aqui.
class MainActivity : TauriActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.RECORD_AUDIO),
                1
            )
        }
    }

    // Hook do Tauri 2: chamado quando o WebView é criado.
    override fun onWebViewCreate(webView: WebView) {
        super.onWebViewCreate(webView)
        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread { request.grant(request.resources) }
            }
        }
    }
}
