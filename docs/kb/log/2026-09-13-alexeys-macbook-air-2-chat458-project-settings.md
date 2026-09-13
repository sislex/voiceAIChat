---
title: chat458-project-settings
date: 2026-09-13
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# chat458-project-settings

## Changes

Project settings now collect project-field changes in a draft with inline
validation, sticky Save/Cancel and navigation protection. Added production
diagnostics, directory checks and machine roles, command syntax previews and
machine execution, type-change previews, masked test users with a Web Reader
login-check action, configurable invitation lifetime and phone layouts.

## Verified findings

- CI branch templates substitute task_number and legacy slug once each.
- The invitation repository already accepted a lifetime, but HTTP and UI exposed
  only the default seven days. Resending now preserves the selected duration.
- Web Reader test-users returns credentials; browser interaction is required
  to establish whether authentication succeeds.
- The server already rejects removal and demotion of the last owner; the REST
  regression now explicitly verifies attempted self-demotion.
- The previous settings KB described local tabs although the host uses routed tabs.

## Documentation

Updated docs/kb/projects.md in the existing settings, types, invitations and
machine-directory sections.

## Validation

Focused UI tests, axe for invalid/dirty settings, and 172 server invitation and
project tests passed. A real Chromium check at 390px reported scrollWidth=390;
the save bar remained inside the viewport. Browser axe also reported zero
violations for validation errors, production results and machine settings.
`npm run gate:fast` completed with exit code 0 after installing the separate
locked dependencies for desktop, agent-tray and login-application.
