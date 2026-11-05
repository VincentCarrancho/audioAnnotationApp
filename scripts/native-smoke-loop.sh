#!/usr/bin/env bash
# Human-in-the-loop script adapted from the diagnosing-bugs HITL template.
# Capture two separate native process runs in two fresh log files.
set -euo pipefail
if [ "$#" -ne 2 ]; then
  printf 'Usage: bash scripts/native-smoke-loop.sh <initial-native-log> <relaunch-native-log>\n' >&2
  exit 2
fi
step() {
  printf '\n>>> %s\n' "$1"
  read -r -p '    [Enter when done] ' _
}
capture() {
  local var="$1" question="$2" answer
  printf '\n>>> %s\n' "$question"
  read -r -p '    > ' answer
  printf -v "$var" '%s' "$answer"
}
step 'In the first Tauri launch, wait for Ready; play twice to completion, or note the error.'
step 'Fully quit the app. Start a new native app process with output captured in the second log.'
step 'In the second launch, wait for Ready; play twice to completion, or note the error.'
step 'Click Reload fixture, wait for Ready, and play once more.'
capture AUDIBLE 'Did all five plays produce an audible tone? (yes/no/unknown)'
capture VISIBLE_ERROR 'Did the UI show Audio error? If so, enter the exact message; otherwise enter none.'
printf '\nAUDIBLE=%s\nVISIBLE_ERROR=%s\n' "$AUDIBLE" "$VISIBLE_ERROR"
if [ "$VISIBLE_ERROR" != 'none' ]; then
  printf 'FAIL: visible error reported by observer\n'
  exit 1
fi
python3 scripts/check-native-smoke.py "$1" "$2"
if [ "$AUDIBLE" != 'yes' ]; then
  printf 'INCONCLUSIVE: audible output was not confirmed\n'
  exit 2
fi
