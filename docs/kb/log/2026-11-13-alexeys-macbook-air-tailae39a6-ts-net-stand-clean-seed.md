---
title: stand-clean-seed
date: 2026-11-13
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# stand-clean-seed

## Changes

Added a plain PostgreSQL stand fixture and a reproducible refresh command using
a disposable database and the Core/Identity provisioning code.

## Verified findings

Identity creates a personal tenant for each user; the fixture additionally has
one team space. Core migrations create the shared service tables. PostgreSQL 17
restore, Core reopening, both password checks, and repeated dump generation pass.
Without VC_TEST_DB_URL, database tests skip and the offline checks run.

## Documentation

- docs/kb/deploy.md, Clean stand database fixture

## Remaining work

The local stand launcher is maintained by the adjacent task.
Validation: all four seed tests and gate:task with VC_TEST_DB_URL passed.
The required gate:fast selected the full fallback for the new fixtures path;
the remote command hit its 300-second limit during browser tests, after
typechecks, tooling, all unit suites and frontend artifact checks passed.
This is not a passing gate:fast result; the workflow must finish that gate.
