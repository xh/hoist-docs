#!/usr/bin/env sh
# Build the Hoist Docs index for a hoist-core checkout. Arguments pass through to IndexBuilder,
# and relative paths resolve from the current directory:
#
#   builders/core/build-index.sh --root ../hoist-core [--version 44.0.0] [--out indexes] [--gzip]
set -e
dir=$(cd "$(dirname "$0")" && pwd)
"$dir/gradlew" -q -p "$dir" installDist
exec "$dir/build/install/hoist-core-index-builder/bin/hoist-core-index-builder" "$@"
