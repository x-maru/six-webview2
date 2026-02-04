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
ARCHIVE="${PKG}.zip"

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
	help.*.md
)

missing=()
for f in "${FILES[@]}"; do
	[ -e "$f" ] || missing+=("$f")
done
if [ ${#missing[@]} -gt 0 ]; then
	echo "ERROR: Missing files: ${missing[*]}" >&2
	exit 3
fi

echo "Packaging version $VERSION into $ARCHIVE (zip)" >&2
rm -f "$ARCHIVE"

# Temp work directory (unique per PID)
TMPDIR="/tmp/six.$$"
trap 'rc=$?; if [ -n "${TMPDIR:-}" ] && [ -d "$TMPDIR" ]; then rm -rf "$TMPDIR"; fi; exit $rc' EXIT
mkdir -p "$TMPDIR/$PKG"

# Copy files into package directory (preserve modes & timestamps if possible)
for f in "${FILES[@]}"; do
		cp -p "$f" "$TMPDIR/$PKG/" || { echo "ERROR: copy failed: $f" >&2; exit 4; }
done

# Verify zip tool availability
if ! command -v zip >/dev/null 2>&1; then
		echo "ERROR: 'zip' command not found. Install zip (e.g. apt install zip)." >&2
		exit 5
fi

# Build zip (recursive, no extra compression flags; Windows 11 can extract natively)
(
	cd "$TMPDIR"
	if [ "${VERBOSE:-}" = "1" ]; then
		zip -r "$SDIR/$ARCHIVE" "$PKG"
	else
		zip -rq "$SDIR/$ARCHIVE" "$PKG"
	fi
)

if [ ! -s "$ARCHIVE" ]; then
		echo "ERROR: Zip not created or empty: $ARCHIVE" >&2
		exit 6
fi
echo "SUCCESS: Created $ARCHIVE ($(du -h "$ARCHIVE" | awk '{print $1}'))" >&2
