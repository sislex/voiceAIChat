---
title: Docker timestamps on older deployment hosts
date: 2026-10-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Docker timestamps on older deployment hosts

Normalize Docker nanosecond timestamps before Python datetime parsing in unchanged-runtime recovery. Python 3.9 and 3.10 reject the unmodified nine-digit fraction; the journal compares millisecond operation boundaries, so microsecond parsing retains sufficient precision.

A regression fixture with actual Docker timestamp shapes fails on Python 3.9 before the fix and passes afterwards, including refusal of a restarted container. Documented in docs/kb/deploy.md. No recovery state is written when timestamp parsing fails.
