---
title: web-reader-ten-cycle-07
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Web Reader cycle 07: Scenario portability and export

The Recorder imports and exports version-1 web-reader-scenario JSON files. Import validates HTTP(S) source URLs, a 1 MB UTF-8 limit, and all 1–200 steps before showing a review. Applying replaces the current page scenario without navigation; cancel leaves it intact. Both directions redact marked secret values. Navigation invalidates pending file reads, and file input resets allow retrying the same file.

Regression checks accompany the implementation; full application gates are required before merging.
