#!/usr/bin/env bash
# Auto-start OmniRoute server from Raycast menubar.
# Raycast extensions cannot spawn background processes directly, so this script
# is invoked via `open` (which CAN launch shell scripts) to start the daemon.
set -euo pipefail

# Try to find the omniroute CLI
OMNIROUTE_BIN=""
for candidate in /opt/homebrew/bin/omniroute /usr/local/bin/omniroute "$HOME/.local/bin/omniroute"; do
  if command -v "$candidate" >/dev/null 2>&1; then
    OMNIROUTE_BIN="$candidate"
    break
  fi
done

if [ -z "$OMNIROUTE_BIN" ]; then
  echo "omniroute CLI not found in PATH" >&2
  exit 1
fi

# Start the server as a daemon (non-blocking)
"$OMNIROUTE_BIN" serve --daemon --no-open 2>&1 || true
