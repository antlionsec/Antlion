#!/bin/sh
# Detached dev-server launcher — double-fork so the process survives the
# invoking shell's process-group cleanup. Works from any clone location.
cd "$(dirname "$0")/.." || exit 1
rm -f dev.log
# Trailing output redirect + full detach
( setsid bun run dev > /dev/null 2>&1 < /dev/null & )
sleep 1
exit 0
