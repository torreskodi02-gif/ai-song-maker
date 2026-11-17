#!/usr/bin/env bash
# AI Song Maker — local Android setup.
# Same flow the GitHub workflow runs: install deps, regenerate the full
# Capacitor Android scaffold with `npx cap add android`, restore our
# committed MainActivity.java, add mic/audio permissions, then sync.
# Run once after cloning, and again any time www/ or capacitor.config.json
# changes before a local build:
#   bash setup-android.sh
#   cd android && ./gradlew assembleDebug
set -e
cd "$(dirname "$0")"

echo "== npm install =="
npm install

if [ -f android/app/src/main/java/app/aisongmaker/MainActivity.java ]; then
  cp android/app/src/main/java/app/aisongmaker/MainActivity.java /tmp/asm-MainActivity.java
  echo "saved committed MainActivity.java"
fi

echo "== npx cap add android (fresh scaffold) =="
rm -rf android
npx cap add android

if [ -f /tmp/asm-MainActivity.java ]; then
  mkdir -p android/app/src/main/java/app/aisongmaker
  cp /tmp/asm-MainActivity.java android/app/src/main/java/app/aisongmaker/MainActivity.java
  echo "restored MainActivity.java"
fi

echo "== mic/audio permissions =="
python3 - android/app/src/main/AndroidManifest.xml <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
for perm in ["android.permission.RECORD_AUDIO",
             "android.permission.MODIFY_AUDIO_SETTINGS",
             "android.permission.INTERNET",
             "android.permission.FOREGROUND_SERVICE",
             "android.permission.WAKE_LOCK"]:
    tag = '<uses-permission android:name="' + perm + '" />'
    if perm not in s:
        s = s.replace("<application", tag + "\n    <application", 1)
open(p, "w").write(s)
print("permissions ok")
PY

sed -i 's/minSdkVersion = 2[0-9]/minSdkVersion = 23/' android/variables.gradle || true
npx cap sync android
echo "== done. Build with: cd android && ./gradlew assembleDebug =="
