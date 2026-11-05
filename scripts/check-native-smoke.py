#!/usr/bin/env python3
"""Classify a single fresh native smoke run. This is a feedback-loop checker, not a playback test."""
import json
import sys


def events_from(lines):
    events = []
    failures = []
    marker = 'wavnotes-smoke: '
    for line in lines:
        if marker not in line:
            continue
        payload = line.split(marker, 1)[1].strip()
        if payload.startswith('error '):
            failures.append(payload)
        for prefix in ('[DEBUG-wav-smoke] ', '[DEBUG-wav-action] '):
            if payload.startswith(prefix):
                try:
                    events.append(json.loads(payload[len(prefix):]))
                except json.JSONDecodeError:
                    return events, failures, True
    return events, failures, False


def classify(first_lines, restart_lines):
    first, first_failures, first_bad = events_from(first_lines)
    restart, restart_failures, restart_bad = events_from(restart_lines)
    if first_bad or restart_bad:
        return 'INCONCLUSIVE', 'truncated or malformed diagnostic event'
    failures = first_failures + restart_failures
    if failures:
        return 'FAIL', '; '.join(failures)
    if any(event.get('event') in ('wave:error', 'load:reject', 'playPause:reject', 'media:error', 'csp:violation') for event in first + restart):
        return 'FAIL', 'diagnostic error, rejection, media error or CSP violation (inspect the log)'
    count = lambda items, name: sum(event.get('event') == name for event in items)
    first_mounts = {event.get('mount') for event in first if event.get('event') == 'wave:ready'} - {None}
    restart_mounts = {event.get('mount') for event in restart if event.get('event') == 'wave:ready'} - {None}
    if not first_mounts or not restart_mounts or first_mounts & restart_mounts:
        return 'INCONCLUSIVE', 'need different ready mounts in two fresh process logs'
    reload_indices = [i for i, event in enumerate(restart) if event.get('event') == 'click:reload']
    if not reload_indices:
        return 'INCONCLUSIVE', 'need in-window reload during second launch'
    reload_index = reload_indices[-1]
    if count(first, 'wave:finish') < 2 or count(restart[:reload_index], 'wave:finish') < 2:
        return 'INCONCLUSIVE', 'need two completed plays in each native launch before reload'
    if count(restart[reload_index + 1:], 'wave:finish') < 1:
        return 'INCONCLUSIVE', 'need one completed play after in-window reload during second launch'
    return 'PASS', 'initial launch, cold relaunch, replays and reload completed without logged errors; audible output requires human confirmation'


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit('usage: python3 scripts/check-native-smoke.py <initial-native-log> <relaunch-native-log>')
    with open(sys.argv[1], encoding='utf-8', errors='replace') as first, open(sys.argv[2], encoding='utf-8', errors='replace') as restart:
        result, detail = classify(first, restart)
    print(f'{result}: {detail}')
    sys.exit({'PASS': 0, 'FAIL': 1, 'INCONCLUSIVE': 2}[result])
