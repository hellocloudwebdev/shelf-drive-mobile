#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE="${GRADLE_USER_HOME:-$HOME/.gradle}/caches/modules-2/files-2.1"
COMPILER="$(find "$CACHE/org.jetbrains.kotlin/kotlin-compiler-embeddable" -type f -name 'kotlin-compiler-embeddable-*.jar' 2>/dev/null | sort -V | tail -n 1)"
if [[ -z "$COMPILER" ]]; then
  echo "No cached kotlin-compiler-embeddable jar found under $CACHE; no downloads attempted." >&2
  exit 2
fi
VERSION="$(basename "$(dirname "$(dirname "$COMPILER")")")"
find_artifact() {
  local group="$1" artifact="$2" version="$3"
  find "$CACHE/$group/$artifact/$version" -type f -name "$artifact-$version.jar" 2>/dev/null | head -n 1
}
STDLIB="$(find_artifact org.jetbrains.kotlin kotlin-stdlib "$VERSION")"
SCRIPT_RUNTIME="$(find_artifact org.jetbrains.kotlin kotlin-script-runtime "$VERSION")"
REFLECT="$(find_artifact org.jetbrains.kotlin kotlin-reflect "$VERSION")"
TROVE="$(find "$CACHE/org.jetbrains.intellij.deps/trove4j" -type f -name 'trove4j-*.jar' 2>/dev/null | sort -V | tail -n 1)"
ANNOTATIONS="$(find "$CACHE/org.jetbrains/annotations" -type f -name 'annotations-*.jar' 2>/dev/null | sort -V | tail -n 1)"
COROUTINES="$(find "$CACHE/org.jetbrains.kotlinx/kotlinx-coroutines-core-jvm" -type f -name 'kotlinx-coroutines-core-jvm-*.jar' 2>/dev/null | sort -V | tail -n 1)"
for required in "$STDLIB" "$SCRIPT_RUNTIME" "$TROVE" "$ANNOTATIONS" "$COROUTINES"; do
  if [[ -z "$required" ]]; then
    echo "Required Kotlin compiler support jar is missing from the local Gradle cache." >&2
    exit 2
  fi
done
COMPILER_CP="$COMPILER:$STDLIB:$SCRIPT_RUNTIME:$TROVE:$ANNOTATIONS:$COROUTINES"
[[ -z "$REFLECT" ]] || COMPILER_CP="$COMPILER_CP:$REFLECT"
APP="${ROOT}/android-overrides/app"
EXECUTOR="$APP/src/main/java/com/hellocloudweb/shelfdrive/BoundedIpcExecutor.kt"
CALLBACK="$APP/src/main/java/com/hellocloudweb/shelfdrive/IpcErrorCallback.kt"
SERVICE_POLICY="$APP/src/main/java/com/hellocloudweb/shelfdrive/ForegroundServiceLifecyclePolicy.kt"
CHECKS="$APP/src/test/kotlin/com/hellocloudweb/shelfdrive/IpcExecutorJvmChecks.kt"
for source in "$EXECUTOR" "$CALLBACK" "$SERVICE_POLICY" "$CHECKS"; do
  [[ -f "$source" ]] || { echo "Missing source: $source" >&2; exit 2; }
done
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipc-executor-jvm.XXXXXX")"
trap 'rm -rf "$BUILD_DIR"' EXIT
mkdir -p "$BUILD_DIR/classes"
java -cp "$COMPILER_CP" org.jetbrains.kotlin.cli.jvm.K2JVMCompiler \
  -no-stdlib -no-reflect -jvm-target 1.8 -classpath "$STDLIB" \
  -d "$BUILD_DIR/classes" "$EXECUTOR" "$CALLBACK" "$SERVICE_POLICY" "$CHECKS"
java -cp "$BUILD_DIR/classes:$STDLIB" com.hellocloudweb.shelfdrive.IpcExecutorJvmChecks
