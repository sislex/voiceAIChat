---
title: web-reader-ten-cycle-10
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Web Reader cycle 10: Recorder recovery and responsive controls

The Recorder keeps scenario playback controls visible when step editing is collapsed; step rows wrap on narrow screens and checkboxes retain their intrinsic width. Failed scenario writes show a retry action using the current edits. Cookie-session reset allows one request, expires after 15 seconds, and aborts on navigation, disposal or unmount; stale responses cannot reload a later page. Reader errors and finished playback results can be dismissed, and recording status remains visible outside the tools menu.

Regression checks accompany the implementation; full application gates are required before merging.

Chromium visual QA at 375px found the first step clipped by the former 180px panel limit. The narrow-screen limit is now 45vh, and the browser regression verifies both horizontal fit and a fully visible first step. The first full gate passed 165 Recorder tests and 730 Chromium tests.
