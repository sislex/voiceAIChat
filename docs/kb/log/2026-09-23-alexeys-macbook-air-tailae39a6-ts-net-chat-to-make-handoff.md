---
title: chat-to-make-handoff
date: 2026-09-23
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# chat-to-make-handoff

## Что сделано

- Extended the atomic conversation draft contract with the Make handoff kind.
- Added server and repository support for idempotent Make conversation creation.
- Added database and REST regressions for replay, scope, project inheritance, and one-time project refresh.

## Что выяснили (факты, которых не было в KB)

- The existing draft idempotency table can protect both target conversation creation and the first stored Make request; the normal message ID then protects turn delivery.
- Make Billing attribution already derives from the stored conversation kind, so the handoff must not introduce a separate execution or charging path.

## Куда занесено

- `docs/kb/protocol.md`

## Открытые вопросы / что осталось

- The Core UI owner must consume the new contract and expose the action in the chat message footer.
- Production release evidence remains pending because this Codex session has neither the protected deploy MCP tool nor a valid production admin browser session.
