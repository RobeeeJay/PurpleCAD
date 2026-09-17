#!/usr/bin/env bash
# Builds the addon with the first cmake that can actually execute.
#
# macOS 27 dropped Rosetta, so an Intel Homebrew under /usr/local leaves
# x86_64 cmake/ninja first on PATH; cmake-js then dies with
# "spawn Unknown system error -86" (EBADARCH). Probing each candidate
# with --version skips those binaries.
set -euo pipefail
cd "$(dirname "$0")"

runs() { "$1" --version >/dev/null 2>&1; }

cmake_bin=""
for c in $(which -a cmake 2>/dev/null) /opt/homebrew/bin/cmake \
  "${ANDROID_HOME:-$HOME/Library/Android/sdk}"/cmake/*/bin/cmake \
  /usr/local/share/android-commandlinetools/cmake/*/bin/cmake; do
  if [ -x "$c" ] && runs "$c"; then
    cmake_bin="$c"
    break
  fi
done
if [ -z "$cmake_bin" ]; then
  echo "No runnable cmake found. On Apple silicon: /opt/homebrew/bin/brew install cmake" >&2
  exit 1
fi

args=(--cmake-path "$cmake_bin")
# cmake-js picks ninja whenever one is on PATH, runnable or not.
if ninja_bin=$(command -v ninja) && ! runs "$ninja_bin"; then
  args+=(--prefer-make)
fi

exec npx cmake-js compile "${args[@]}" "$@"
