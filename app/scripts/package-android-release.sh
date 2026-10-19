#!/usr/bin/env bash
set -euo pipefail

build_tools="${ANDROID_HOME:?ANDROID_HOME must be configured}/build-tools/36.0.0"
apksigner="$build_tools/apksigner"
apk="src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk"
aab="src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab"
release_dir="android-release"

test -x "$apksigner"
test -f "$apk"
test -f "$aab"
test -n "${ANDROID_SIGNING_CERT_SHA256:-}"

signer_output="$($apksigner verify --verbose --print-certs "$apk")"
actual_fingerprint="$(printf '%s\n' "$signer_output" | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' | head -n 1 | tr -d ':[:space:]' | tr '[:lower:]' '[:upper:]')"
expected_fingerprint="$(printf '%s' "$ANDROID_SIGNING_CERT_SHA256" | tr -d ':[:space:]' | tr '[:lower:]' '[:upper:]')"

test -n "$actual_fingerprint"
if [ "$actual_fingerprint" != "$expected_fingerprint" ]; then
  echo "Android release certificate does not match the pinned production certificate." >&2
  exit 1
fi

jarsigner -verify "$aab" >/dev/null
node scripts/verify-aab-signer.cjs "$aab" "$ANDROID_SIGNING_CERT_SHA256"

version="$(node -p "require('./src-tauri/tauri.conf.json').version")"
version_code="$(sed -n 's/^tauri.android.versionCode=//p' src-tauri/gen/android/app/tauri.properties | head -n 1)"
test -n "$version_code"
if [[ "${GITHUB_REF_TYPE:-}" == "tag" ]]; then
  release_tag="${GITHUB_REF_NAME:?GITHUB_REF_NAME must be set for tag builds}"
else
  release_tag="v${version}"
fi
node scripts/verify-android-release-version.cjs \
  --tag "$release_tag" \
  --generated-properties src-tauri/gen/android/app/tauri.properties

if [ -L "$release_dir" ]; then
  echo "Android release staging path must not be a symbolic link." >&2
  exit 1
fi
mkdir -p "$release_dir"

# Remove only obsolete ABI-specific APKs in the local staging directory.
# Never target built outputs, downloaded releases, or public release assets.
shopt -s nullglob
for stale_apk in \
  "$release_dir"/Shelf-Drive-v*-android-arm64-v8a.apk \
  "$release_dir"/Shelf-Drive-v*-android-armeabi-v7a.apk \
  "$release_dir"/Shelf-Drive-v*-android-x86.apk \
  "$release_dir"/Shelf-Drive-v*-android-x86_64.apk; do
  rm -f -- "$stale_apk"
done

cp "$apk" "$release_dir/ShelfDrive_${version}.apk"
cp "$aab" "$release_dir/ShelfDrive_${version}.aab"

staged_apks=("$release_dir"/*.apk)
staged_aabs=("$release_dir"/*.aab)
if (( ${#staged_apks[@]} != 1 )) || [ "${staged_apks[0]}" != "$release_dir/ShelfDrive_${version}.apk" ]; then
  echo "Android release staging must contain exactly the universal APK for $version." >&2
  exit 1
fi
if (( ${#staged_aabs[@]} != 1 )) || [ "${staged_aabs[0]}" != "$release_dir/ShelfDrive_${version}.aab" ]; then
  echo "Android release staging must contain exactly the universal AAB for $version." >&2
  exit 1
fi

(
  cd "$release_dir"
  sha256sum "ShelfDrive_${version}.apk" "ShelfDrive_${version}.aab" > SHA256SUMS
)

node scripts/create-android-release-manifest.cjs \
  --apk "$release_dir/ShelfDrive_${version}.apk" \
  --version "$version" \
  --version-code "$version_code" \
  --repository "${GITHUB_REPOSITORY:-hellocloudwebdev/shelf-drive-mobile}" \
  --tag "$release_tag" \
  --output "$release_dir/android-update.json"

if [[ -n "${TAURI_PRIVATE_KEY_PATH:-}" ]]; then
  npx tauri signer sign -f "$TAURI_PRIVATE_KEY_PATH" "$release_dir/android-update.json"
elif [[ -n "${TAURI_PRIVATE_KEY:-}" ]]; then
  npx tauri signer sign "$release_dir/android-update.json"
else
  echo "A Tauri updater private key is required to sign android-update.json" >&2
  exit 1
fi
test -s "$release_dir/android-update.json.sig"
