---
title: make-drafts-private-replies
date: 2026-09-13
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# make-drafts-private-replies

## Changes

- Added persistent empty directories, file/folder action menus, directory move/delete, path synchronization, and independent project/file drafts with confirmed tab closing and session order.
- Required reviewed replacement fingerprints on HTTP apply; added concrete search occurrences and single replacement. Dry runs do not write or emit changes, and stale previews are rejected.
- Added arbitrary snapshot-pair comparisons and historical read-only tabs excluded from draft writes and formatting.
- Added 390/768/custom preview dimensions, rotation, URL-carried colour scheme, recursive media-condition emulation, and separate-window theme persistence.
- Reused existing publication day/referrer statistics and clipboard fallback; generated QR locally with qrcode.
- Added separate private owner reply storage, explicit owner-only hydration, filters, retryable reply drafts, and privacy regressions across project/public/event representations.
- Preserved autosave/format settings, recorded successful write times, retained failed drafts, and added beforeunload protection. Added <=720 px workspace segments and low-memory lite input.
- Removed Brief wrapper stripping and strengthened its prompt. Normalization preserves supported nulls and omits only an absent optional decision link; complete schema/readiness validation remains mandatory.

## Verification

- Regression markers T1–T10 cover the required workspace and Brief cases across package DOM, workspace/route, and browser tests.
- The real 390 px browser flow passed, including 720/721 boundaries, single and bulk replacement, historical reading, computed CSS/matchMedia, and QR decoding without external requests.
- The focused Brief suite passed 70 tests; the Make gate passed its workspace and bridge checks.
- The make-ui gate passed 148 package tests, host contract checks, and artifact browser checks.
- Final `npm run gate:fast` passed with exit code 0, including affected consumers of the shared contracts and all 16 final browser tests. The 390 px flow also verified clipboard copying and local QR decoding.

## Knowledge base

- Updated the existing Make and DevelopmentReadiness sections rather than creating duplicate articles.
- Confirmed that Make UI is independently built; a web-only rebuild does not refresh its artifact.
- Corrected the previously documented discrepancy where the Brief parser accepted two introductory phrases and JSON fences.
