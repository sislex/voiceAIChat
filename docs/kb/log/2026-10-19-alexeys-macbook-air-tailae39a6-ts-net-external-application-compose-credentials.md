---
title: External application Compose credentials
date: 2026-10-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Forward external application credentials to Core

Live profile commissioning exposed that external Make was enabled in the manifest but could not issue an entry ticket. Root Compose omitted the configured per-application credentials. It now forwards each application's ticket/RPC token, inbound service token and MCP signing secret to Core, with empty defaults and no shared-secret fallback.

The Compose regression test renders the real configuration with all credential keys configured and absent, verifies their exact Core values, and checks that other services do not receive them. The focused test passed. On the isolated Docker stand, Core issued an external Make ticket (200), published Make 1.8.1 redeemed it over certificate-verified HTTPS (302) and set a Secure/HttpOnly session cookie. Reuse was rejected with 409 ticket_used. The real LLM Runner inventory returned only history for external Make, excluding the local Make tool. The required quick gate expanded to the full Core gate and passed with exit 0, including browser integrations with one worker.

Updated docs/kb/deploy.md. Production deployment remains pending the release train and snapshot acceptance.
