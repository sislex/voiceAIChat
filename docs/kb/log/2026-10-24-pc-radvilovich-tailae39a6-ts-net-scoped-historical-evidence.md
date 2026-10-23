---
title: scoped-historical-evidence
date: 2026-10-24
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# Scoped historical evidence (SISL-774)

Added a hash-only remote MCP operation with an optional trusted source/authority
port. It checks the existing run scope and current project membership before
reading and before disclosing a digest. Tests cover exact synthetic bytes,
isolation, revocation, source replacement, unavailable/oversized sources and
sanitized errors. No shell or machine filesystem fallback is used.

Documented the boundary in docs/kb/llm.md and the blocked historical claims in
docs/test-evidence/SISL-774.md. The original journals and their SHA256 values
remain unverified: no production source adapter or capability producer is
commissioned. Host credentials, roots, mirrors, sandbox and UI are unchanged.
