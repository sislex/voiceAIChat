---
title: chat-446-browser-check
date: 2026-09-12
machine: germany-4-8-60
author: unknown
---

# chat-446-browser-check

## Changes

- Added the exact browser-check URL and required checks to development prompts, including approved-plan transitions.
- Bound completed Reader observations to signed run/step tokens and stored safe metadata in CI events.
- Added a minimum execution gate and explicit blocked/infrastructure diagnostics.
- Added authenticated on-demand screenshot viewing and structured evidence to the run feed.
- Added unit, contract, authorization and DOM tests; enabled required Chromium tools in Claude's allow-list.

## Verified findings

Browser inspection results do not consistently contain page metadata. The MCP evidence
collector queries trusted session status for the actual URL and viewport. Model text and
tool-call announcements do not count as completed browser checks.

The expanded gate also reproduced an existing Image Studio close/route race in the
full DOM suite. Closing its viewer now clears the route in the same action,
preventing a delayed route effect from reopening the directly linked image.

## Knowledge base

- docs/kb/features/ci-runner.md
- docs/kb/ui.md

## Remaining verification

The task's internal browser returned `fetch failed` for open/read/screenshot, including
the required Release Center URL on port 5173. The dev frontend and backend both returned
HTTP 200. The deployed Playwright Reader container was restarting with
`mkdir: cannot create directory '/data': Permission denied`; browser-runner was
healthy. The project had no configured test users. Four-viewport visual verification
and the browser E2E remain blocked.
The wider Release Center lifecycle requested in CHAT-446 is not implemented by this slice.

```json
{
  "status": "infrastructure_error",
  "targetUrl": "http://machine.internal:5173/#/projects/e3dea006-b6f7-45ea-8fa3-97502501456d/releases",
  "openedUrl": null,
  "requiredViewports": [1440, 1024, 390, 320],
  "checkedViewports": [],
  "scenarios": [
    { "name": "Whole project", "status": "blocked" },
    { "name": "Applications", "status": "blocked" }
  ],
  "toolFailures": [
    { "tool": "open", "error": "fetch failed" },
    { "tool": "read", "error": "fetch failed" },
    { "tool": "screenshot", "error": "fetch failed" }
  ],
  "domA11yStylesConsoleNetwork": "not_checked",
  "screenshots": [],
  "devFrontendHttpStatus": 200,
  "devBackendHttpStatus": 200,
  "diagnosis": "Playwright Reader restarts: mkdir /data: Permission denied",
  "configuredTestUsers": 0
}
```
