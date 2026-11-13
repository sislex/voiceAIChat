---
title: android-apk-distribution
date: 2026-10-29
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# android-apk-distribution

## Implementation

Pinned Android 0.1.1, added the Shared manifest contract and public manifest/APK
routes with SHA-256 verification and ETag revalidation. The remote Machines proxy
preserves public GET/HEAD downloads. Core UI source changes belong to its owner.

## Verified knowledge

The owner release manifest lacks versionName/versionCode; release commit
7d90ff455a4a495185bbb76d4bfc6f1b27c0d005 declares 0.1.1/code 2 in Gradle.
The public manifest replaces the upstream URL with the Core APK endpoint.

## Updated topic

- docs/kb/clients.md — Android APK distribution

## Validation

`npm run gate:fast` passed with exit 0 (run
`20261028213858967-2c18db3f-8021-49e4-89f0-99a18fb1b16d`).
The gate used the installed Python 3.12 on PATH, since Apple's Python lacks
`hashlib.scrypt`; no production code or test assertions were changed for that
known host prerequisite. Server suites passed 2366 tests; browser integration
and the remaining workspace/tooling checks passed.

## Remaining acceptance

Phone QR scan and installation on production require the release to be deployed.
No production deployment was performed in this task.
