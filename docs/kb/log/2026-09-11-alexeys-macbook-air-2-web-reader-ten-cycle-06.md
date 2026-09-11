---
title: web-reader-ten-cycle-06
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Web Reader cycle 06: Scenario editing

The Recorder scenario editor supports manual click/input steps, duplication, action-kind and Enter editing, and a 200-step counter. Missing selectors prevent playback/export. Undo and redo retain at most 30 edits and reset on page changes or secret classification; temporary secret values are cleared when targets or ordering change and never enter edit history.

Regression checks accompany the implementation; full application gates are required before merging.
