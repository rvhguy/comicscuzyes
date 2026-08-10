#!/bin/bash
# Builds the drag-and-drop app. Run this ON A MAC (osacompile is macOS-only).
#
#   ./build-droplet.sh SUBMIT_SECRET
#
# Produces "Send to Comics Cuz Yes.app" next to this script. Drag it to
# Applications or straight into her Dock.

set -euo pipefail
cd "$(dirname "$0")"

SECRET="${1:-}"
if [ -z "$SECRET" ]; then
  echo "usage: $0 <SUBMIT_SECRET>" >&2
  exit 1
fi

APP="Send to Comics Cuz Yes.app"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Bake the secret in. Done with awk rather than sed so slashes and ampersands
# in a generated secret can't corrupt the substitution.
awk -v s="$SECRET" '
  /^property submitSecret :/ { print "property submitSecret : \"" s "\""; next }
  { print }
' droplet.applescript > "$TMP/droplet.applescript"

rm -rf "$APP"
osacompile -o "$APP" "$TMP/droplet.applescript"

# Ad-hoc signature keeps macOS from flagging it as damaged after edits.
codesign --force --deep --sign - "$APP" 2>/dev/null || \
  echo "note: could not ad-hoc sign; first launch may need right-click > Open"

echo "Built: $APP"
echo
echo "Test it:  drop a PNG on the app icon."
echo "If macOS refuses to open it, right-click the app once and choose Open."
