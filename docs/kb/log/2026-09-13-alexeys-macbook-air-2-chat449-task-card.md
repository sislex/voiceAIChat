---
title: chat449-task-card
date: 2026-09-13
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# chat449-task-card

## Changes

Implemented the new task-card improvements in CHAT-449: stable stage panel
portals, draft sorting/editing/material preservation, inline statement editing,
workflow dates and mobile details, stage errors with existing retry actions,
duration navigation, expandable title, clipboard and cancellation feedback,
and actionable empty states. Added three stories, DOM regressions with TC1–TC8
markers, style checks and a standalone Chromium/axe check at 1280px and 390px.

Development Brief parsing now removes only null optional decision question
links before strict validation. Initial and recovery prompts explicitly require
string links or omission; incompatible types remain errors.

## Verified findings

Moving a panel between keyed StageCard parents remounted it. A stable portal
with a movable DOM host preserves the React instance and shared initial loads.
Existing draft updates already accepted Make sources and attachment upload IDs;
the missing editor behavior was loading and displaying saved Make paths.
The brief parser already enforced one JSON object and numeric schemaVersion=2,
but previously rejected questionId:null instead of treating it as an absent link.

## Knowledge base

- docs/kb/projects.md — existing new/legacy task-card section
- docs/kb/features/task-preparation.md — existing readiness section

## Validation

Focused DOM and preparation regression suites were run during implementation.
Final gate and browser results are recorded in the task completion report.
