---
title: web-reader-ten-cycle-08
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Web Reader cycle 08: Playback validation and lifecycle

Scenario playback validates the complete bounded input before sending any command, including runtime step shapes and temporary secret values. Request IDs remain unique if the injected ID factory repeats. Invalid timeouts fall back to 12 seconds, excessive values cap at two minutes, and settling delays stay below the timeout. Malformed outcomes are ignored; throwing progress observers cannot strand a run or prevent cleanup.

Regression checks accompany the implementation; full application gates are required before merging.
