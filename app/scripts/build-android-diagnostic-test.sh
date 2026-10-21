#!/usr/bin/env bash
# Local TEST candidate only. Never calls a release, upload, push, tag, or updater-packaging API.
set -euo pipefail
cd "$(dirname "$0")/.."
version="$(node -p "require('./package.json').version")"
test "$version" = '4.5.1'
test_app_id='com.hellocloudweb.shelfdrive.diagnostictest'
grep -Fq "applicationId = \"$test_app_id\"" android-overrides/app/build.gradle.kts
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
# Explicitly request universal APK + AAB. This invokes the local Android build only.
npm run tauri android build -- --target aarch64 armv7 i686 x86_64 --apk true --aab true --ci
outputs='src-tauri/gen/android/app/build/outputs'
apk="$outputs/apk/universal/release/app-universal-release.apk"
aab="$outputs/bundle/universalRelease/app-universal-release.aab"
test -s "$apk"
test -s "$aab"
# Existing checker verifies all four native ABIs, Baseline Profile, and 16 KiB alignment.
ANDROID_HOME="$ANDROID_HOME" bash scripts/verify-android-artifacts.sh "$outputs"

build_tools="$(find "$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -n 1)"
apksigner="$build_tools/apksigner"
aapt="$build_tools/aapt"
test -x "$apksigner"
test -x "$aapt"
# Derive the expected TEST signer fingerprint from the dedicated keystore without printing key data.
test_fingerprint="$(keytool -exportcert -alias "$DIAGNOSTIC_TEST_KEY_ALIAS" \
  -keystore "$DIAGNOSTIC_TEST_KEYSTORE" \
  -storepass:env DIAGNOSTIC_TEST_STORE_PASSWORD |
  openssl dgst -sha256 | awk '{print $NF}' | tr -d ':' | tr '[:lower:]' '[:upper:]')"
test "${#test_fingerprint}" -eq 64
apk_signer_output="$("$apksigner" verify --print-certs "$apk")"
apk_fingerprint="$(printf '%s\n' "$apk_signer_output" | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' | head -n 1 | tr -d ':[:space:]' | tr '[:lower:]' '[:upper:]')"
test "$apk_fingerprint" = "$test_fingerprint"
if ! node scripts/verify-aab-signer.cjs "$aab" "$test_fingerprint" >/dev/null 2>&1; then
  echo 'AAB signer does not match the dedicated TEST keystore.' >&2
  exit 1
fi

expected_code="$(node -e "const [a,b,c]=process.argv[1].split('.').map(Number); process.stdout.write(String(a*1000000+b*1000+c))" "$version")"
apk_badging="$("$aapt" dump badging "$apk")"
printf '%s\n' "$apk_badging" | grep -Fq "package: name='$test_app_id' versionCode='$expected_code' versionName='$version'"
# AAB package/version metadata is read with the Android bundletool CLI (or caller-provided jar).
bundletool_jar="${BUNDLETOOL_JAR:-}"
if [[ -z "$bundletool_jar" ]]; then
  bundletool_jar="$(find "$HOME/.gradle/caches" -type f -name 'bundletool-*.jar' -print -quit 2>/dev/null || true)"
fi
if [[ -n "${BUNDLETOOL:-}" ]]; then
  aab_manifest="$("$BUNDLETOOL" dump manifest --bundle="$aab" --module=base)"
elif [[ -n "$bundletool_jar" && -f "$bundletool_jar" ]]; then
  aab_manifest="$(java -jar "$bundletool_jar" dump manifest --bundle="$aab" --module=base)"
else
  echo 'bundletool CLI/JAR is required to verify the AAB manifest; set BUNDLETOOL or BUNDLETOOL_JAR.' >&2
  exit 1
fi
printf '%s\n' "$aab_manifest" | grep -Eq "package=['\"]$test_app_id['\"]"
printf '%s\n' "$aab_manifest" | grep -Eq "android:versionCode=['\"]$expected_code['\"]"
printf '%s\n' "$aab_manifest" | grep -Eq "android:versionName=['\"]$version['\"]"

out="${DIAGNOSTIC_TEST_OUTPUT:-/dev/shm/shelf451-test-build/output}"
mkdir -p "$out"
cp "$apk" "$out/ShelfDrive_${version}_TEST_universal.apk"
cp "$aab" "$out/ShelfDrive_${version}_TEST_universal.aab"
(cd "$out" && sha256sum "ShelfDrive_${version}_TEST_universal.apk" \
  "ShelfDrive_${version}_TEST_universal.aab" > SHA256SUMS.txt)
printf 'Local-only TEST candidate; verified package %s, version %s, four ABIs, APK/AAB signatures. Artifacts: %s\n' \
  "$test_app_id" "$version" "$out"
