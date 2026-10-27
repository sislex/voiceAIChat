---
title: OpenAI catalog refresh
date: 2026-10-25
---

# OpenAI catalog refresh

Added GPT-6.1 Sol, GPT-6 Sol and GPT-6 Luna to Shared presets, Standard estimates
and database price seeds. Seeds include the supported Standard/Batch/Flex/Fast
short/long categories and preserve operator overrides. The price API now accepts
six decimals. The UI owner has the corresponding input validation update.
Official sources and unsupported pricing dimensions are recorded in
`docs/kb/data-auth.md`.

Validation: Shared and Server TypeScript checks passed. Regression cases were
updated but not executed, following the owner's instruction to run tests only
following a build failure. No deployment or live database mutation occurred.
Publishing Shared and upgrading consumer pins remain release work.
