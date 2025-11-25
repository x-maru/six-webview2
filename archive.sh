#!/bin/bash

set -euo pipefail

# Always operate from script directory so relative paths resolve even if invoked elsewhere.
SDIR=$(cd "$(dirname "$0")" && pwd)
cd "$SDIR"

## Extract VERSION (string) from _six.js (handles quoted value e.g. '0.9.1').
raw_line="$(grep -m1 -E 'const[[:space:]]+VERSION[[:space:]]*=' _six.js || true)"
# Extract quoted or unquoted RHS up to semicolon; handle optional BOM by not anchoring at line start.
VERSION="$(printf '%s' "$raw_line" | tr -d '\r' | sed -E "s/.*const[[:space:]]+VERSION[[:space:]]*=[[:space:]]*['\"]([^'\"]+)['\"].*/\1/;
											   s/.*const[[:space:]]+VERSION[[:space:]]*=[[:space:]]*([^;[:space:]]+).*/\1/;
											   s/[[:space:]]//g")"

if [ -z "${VERSION}" ]; then
	echo "ERROR: VERSION not found in _six.js (line grep returned: '$raw_line')" >&2
	head -n8 _six.js >&2 || true
	exit 1
fi

if ! printf '%s' "$VERSION" | grep -Eq '^[0-9]+(\.[0-9]+)*$'; then
	echo "ERROR: Extracted VERSION '$VERSION' not numeric dotted string" >&2
	exit 2
fi

PKG="six_v${VERSION}"
ARCHIVE="${PKG}.tar"

FILES=(
	six.ps1
	six_wrap.ps1
	_six.js
	_six.html
	_six.css
	_six.cs
	_six.customize
	1024x1024.png
	512x512.png
	256x256.png
	six_shortcut.ico
	install.cmd
	README.md
)

missing=()
for f in "${FILES[@]}"; do
	[ -e "$f" ] || missing+=("$f")
done
if [ ${#missing[@]} -gt 0 ]; then
	echo "ERROR: Missing files: ${missing[*]}" >&2
	exit 3
fi

echo "Packaging version $VERSION into $ARCHIVE" >&2
rm -f "$ARCHIVE"

# Use verbose flag if VERBOSE=1 in environment
TARFLAGS="cf"
if [ "${VERBOSE:-}" = "1" ]; then TARFLAGS="cvf"; fi

tar $TARFLAGS "$ARCHIVE" --transform="s,^,${PKG}/," "${FILES[@]}"

if [ ! -s "$ARCHIVE" ]; then
	echo "ERROR: Archive not created or empty: $ARCHIVE" >&2
	exit 4
fi
echo "SUCCESS: Created $ARCHIVE ($(du -h "$ARCHIVE" | awk '{print $1}'))" >&2

