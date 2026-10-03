---
title: c23-environment-vpn
date: 2026-10-04
machine: alexeys-macbook-air-tailae39a6-ts-net
author: unknown
---

# c23-environment-vpn

## Changes

- Added managed environment TCP grants, device tagging, persistent application state and generation reservations to VpnService.
- Exposed grant operations/state and VPN addresses through machines and Kanban RPC; added telemetry machine views.
- Added fake Tailscale, injected RPC and telemetry tests.

## Findings

- The pinned Agent contract accepts VPN observations but does not declare the optional newer hostName field; Core reads it defensively without changing the external package.
- Sandbox subprocess restrictions prevent npm scripts and the affected-gate planner from running normally. Direct Node entry points support focused validation.

## Documentation

- docs/kb/machines.md, Environment machine-to-machine grants (C23).

## Commissioning

- Supervisor runs the required affected gate. Real tailnet connectivity and operator commissioning remain separate from implementation tests.
