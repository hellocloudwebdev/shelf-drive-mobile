#!/usr/bin/env bash
# Local candidate only. Never calls a release, upload, push or updater-packaging API.
set -euo pipefail
cd "$(dirname "$0")/.."
version="$(node -p "require('./package.json').version")"
test "$version" = '4.5.0'
grep -q 'applicationId = "com.hellocloudweb.shelfdrive.diagnostictest"' android-overrides/app/build.gradle.kts
: "${ANDROID_HOME:?Set ANDROID_HOME to the Android SDK}"
: "${JAVA_HOME:?Set JAVA_HOME to a Java 17 installation}"
: "${DIAGNOSTIC_TEST_KEYSTORE:?Provide a dedicated test-only JKS, never the production key}"
: "${DIAGNOSTIC_TEST_KEY_ALIAS:?Provide the test key alias}"
: "${DIAGNOSTIC_TEST_KEY_PASSWORD:?Provide the test key password}"
: "${DIAGNOSTIC_TEST_STORE_PASSWORD:?Provide the test store password}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export NDK_HOME="$ANDROID_HOME/ndk/30.0.14904198"
export ANDROID_NDK_HOME="$NDK_HOME"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}"
# Conserve build-disk space; these flags do not impose diagnostic capture or retention limits.
export CARGO_PROFILE_RELEASE_DEBUG=0
export CARGO_PROFILE_RELEASE_STRIP=symbols
export CARGO_PROFILE_RELEASE_INCREMENTAL=false
export GRADLE_OPTS='-Dorg.gradle.workers.max=2'
if [[ ! -d src-tauri/gen/android ]]; then npm run tauri android init; fi
node scripts/apply-android-overrides.cjs
printf 'keyAlias=%s\nkeyPassword=%s\nstorePassword=%s\nstoreFile=%s\n' \
  "$DIAGNOSTIC_TEST_KEY_ALIAS" "$DIAGNOSTIC_TEST_KEY_PASSWORD" \
  "$DIAGNOSTIC_TEST_STORE_PASSWORD" "$DIAGNOSTIC_TEST_KEYSTORE" \
  > src-tauri/gen/android/app/keystore.properties
chmod 600 src-tauri/gen/android/app/keystore.properties
npm run tauri android build -- --target aarch64 armv7 i686 x86_64 --apk true --aab false --ci
out="${DIAGNOSTIC_TEST_OUTPUT:-$PWD/android-diagnostic-test}"
mkdir -p "$out"
cp src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk \
  "$out/ShelfDrive_4.5.0_TEST_universal.apk"
(cd "$out" && sha256sum ShelfDrive_4.5.0_TEST_universal.apk > SHA256SUMS.txt)
printf 'Local-only test candidate: %s\n' "$out"
