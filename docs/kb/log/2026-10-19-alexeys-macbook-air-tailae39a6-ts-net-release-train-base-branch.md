---
title: release-train-base-branch
date: 2026-10-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Release train base branch

Documented the Release Center base-branch validation that rejected the Core train after its full gate and main merge. The project used dev for CI, while the train requested main.

The operator recorded the existing setting, selected main for the branch admission, resumed journal 0e091d1f-17fa-431c-9aad-2af913d0d697, and restored dev after release/0.1.480 was accepted. The journal completed and the release preparation retained its fixed source. Production deployment was not part of that resume.

Updated docs/kb/deploy.md with the prerequisite and the reversible operator procedure.
