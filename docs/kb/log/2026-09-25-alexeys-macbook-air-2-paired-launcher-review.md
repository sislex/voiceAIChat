---
title: paired-launcher-review
date: 2026-09-25
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Paired launcher review

Recovered the first worker's source-runtime installation patch after its required
supervisor command failed before artifact upload. The original attempt checkout
and index remain unchanged; recovery used a separate temporary Git index.

Review adds an explicit v2 `--source-request` companion requirement, including
replay of an existing legacy runtime. It also fixes the pre-existing controlled
UI fixture to use the assigned private runtime rather than creating directories
outside the worker boundary. No native permission was broadened and HOME was
not changed.

The previous fixture failure reproduced under the actual Codex native gate with
network enabled. After the fix, all 32 UI-owner/paired-runtime process tests pass
under that same restrictive boundary. The full native gate then passed 108 tooling tests but exposed independent
Core server fixture failures: forbidden ancestor directory reads during cleanup,
preview writes to the real user data directory, and a hardcoded Runner SQLite
path outside assigned tmp. These are assigned to the separate native-gate worker;
full combined owner validation remains pending. The installer metadata assertion
now verifies the generated paired launcher while preserving environment and argv.

The independent Linux generated-wrapper/process suite also passed 18/18,
including concurrent publication, corruption rejection and detached stability.
The retained fixture finished with no surviving private processes, cleanup
complete, 107.7 MB peak memory and no OOM. It exercised no host installation.

Updated topics: deployment and testing operations. This is isolated source/tooling
work; no installation, production effect or task/stage acceptance was performed.
