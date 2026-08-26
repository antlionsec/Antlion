#!/bin/sh
# Detached dev-server launcher — double-fork so the process survives the
# invoking shell's process-group cleanup.
cd /home/z/my-project
rm -f dev.log
# Trailing output redirect + full detach
( setsid bun run dev > /dev/null 2>&1 < /dev/null & )
sleep 1
exit 0
