---
title: pin-published-make-1-8-1
date: 2026-10-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Pin published Make 1.8.1

Updated the tools lock and Compose image from Make 1.8.0 to the already published
1.8.1 commit `b04733783732b654ba02ee090f63dec564eada56`. The interrupted train
completed this owner's publication and verification. Its release assets and tag
were checked again before pinning; no release artifact was replaced.

The release planner compares owner main and dev. Since both already contain
1.8.1, restarting a train without this pin would leave Core on 1.8.0. The
remaining owners will be released through a fresh journal. Recorded the pin in
the deployment topic. This change alone does not deploy Core or Make.
