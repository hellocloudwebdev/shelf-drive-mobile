#!/usr/bin/env bash
set -euo pipefail

output_dir="${1:?Usage: resolve-previous-android-manifest.sh <output-directory>}"
repository="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be configured}"

# A successful empty release list means this is the repository's first release.
# Any API/permission/rate-limit failure aborts under set -e rather than skipping
# the versionCode monotonicity check.
release_json="$(gh release list --repo "$repository" --json tagName,isDraft --limit 1000)"
previous_tag="$(printf '%s' "$release_json" | node -e '
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { input += chunk; });
process.stdin.on("end", () => {
  const releases = JSON.parse(input);
  const previous = releases.find(release => !release.isDraft);
  if (previous?.tagName) process.stdout.write(previous.tagName);
});
')"

# A repository with no published predecessor, or a pre-updater predecessor with
# no manifest, has no comparable Android versionCode yet.
if [ -z "$previous_tag" ]; then
  exit 0
fi

assets_json="$(gh release view "$previous_tag" --repo "$repository" --json assets)"
has_manifest="$(printf '%s' "$assets_json" | node -e '
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { input += chunk; });
process.stdin.on("end", () => {
  const release = JSON.parse(input);
  process.stdout.write(String((release.assets || []).some(asset => asset.name === "android-update.json")));
});
')"
if [ "$has_manifest" != "true" ]; then
  exit 0
fi

mkdir -p "$output_dir"
# A listed but unavailable asset is an error; do not publish without the gate.
gh release download "$previous_tag" --repo "$repository" --dir "$output_dir" --pattern android-update.json >&2
manifest="$output_dir/android-update.json"
if [ ! -s "$manifest" ]; then
  echo "The previous release listed android-update.json, but the downloaded manifest is missing or empty." >&2
  exit 1
fi
printf '%s\n' "$manifest"
