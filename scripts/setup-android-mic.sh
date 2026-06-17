#!/usr/bin/env bash
# Injeta as permissoes Android necessarias no projeto gerado pelo
# `tauri android init`. Roda no CI logo depois do init.
set -euo pipefail

MANIFEST="src-tauri/gen/android/app/src/main/AndroidManifest.xml"
MAIN_ACTIVITY_DEST="src-tauri/gen/android/app/src/main/java/com/radio/walkietalkie/MainActivity.kt"

echo "==> Manifest antes:"
cat "$MANIFEST"

# 1) Adiciona permissoes de audio e rede antes da tag <application>.
if ! grep -q "RECORD_AUDIO" "$MANIFEST"; then
  perl -0pi -e 's#(\s*<application)#\n    <uses-permission android:name="android.permission.RECORD_AUDIO"/>\n    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS"/>\n    <uses-feature android:name="android.hardware.microphone" android:required="false"/>\n$1#' "$MANIFEST"
fi
if ! grep -q "android.permission.INTERNET" "$MANIFEST"; then
  perl -0pi -e 's#(\s*<application)#\n    <uses-permission android:name="android.permission.INTERNET"/>\n$1#' "$MANIFEST"
fi
if ! grep -q "android.permission.ACCESS_NETWORK_STATE" "$MANIFEST"; then
  perl -0pi -e 's#(\s*<application)#\n    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/>\n$1#' "$MANIFEST"
fi
if grep -q "usesCleartextTraffic" "$MANIFEST"; then
  perl -0pi -e 's#android:usesCleartextTraffic="[^"]*"#android:usesCleartextTraffic="true"#' "$MANIFEST"
else
  perl -0pi -e 's#<application#<application android:usesCleartextTraffic="true"#' "$MANIFEST"
fi

# 2) Substitui a MainActivity por uma que concede o microfone ao WebView.
if [ -f "android/MainActivity.kt" ]; then
  mkdir -p "$(dirname "$MAIN_ACTIVITY_DEST")"
  cp android/MainActivity.kt "$MAIN_ACTIVITY_DEST"
  echo "==> MainActivity.kt substituída."
fi

echo "==> Manifest depois:"
cat "$MANIFEST"
echo "==> MainActivity gerada (referência):"
find src-tauri/gen/android -name "MainActivity.kt" -exec echo {} \; -exec cat {} \;
