---
title: voice-module-configuration
date: 2026-10-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# voice-module-configuration

## Changes

Added the optional Shared `CapabilityStatus.configured` field and populated it
from Core's STT/TTS configuration. Health, missing models and tariff denials
preserve this flag, allowing the browser to hide onboarding on chat-only stands.

## Verified behavior

Five HTTP regressions cover absent modules, an offline configured STT service,
a missing Whisper model, TTS-only configuration and tariff-denied configured
voice. These and the existing account-access suite passed (21 tests).

## Knowledge

Updated `docs/kb/protocol.md`, Voice module configuration.

## Remaining acceptance

The owner UI must consume the flag and be checked on the Docker stand after
its immutable artifact is pinned. Source checks do not prove stand deployment.
