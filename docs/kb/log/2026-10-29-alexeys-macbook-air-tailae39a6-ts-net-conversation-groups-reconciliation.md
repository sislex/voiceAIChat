---
title: conversation-groups-reconciliation
date: 2026-10-29
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# conversation-groups-reconciliation

## Что сделано

Reconciled all four sections of `conversation-groups.md` against Core HEAD `355efc40`, including the drift since `4242196b`. The earlier `android-routes-conversation-groups` log explicitly covered only two Android REST constants; it was not evidence of a full reconciliation.

Verified sections and sources:

- **Модель и владение**: `packages/shared/src/types.ts:851` and conversation fields; `protocol.ts:241` route helpers; `chatContract.ts` group permissions and route templates. `ChatRepo.listConversationGroups` scopes the catalog to tenant/user and counts memberships.
- **Хранение и инварианты**: `schema.ts:53` group ownership/order uniqueness and cascading membership keys; `schemaPg.ts` generated PostgreSQL DDL and archive index; `database.ts:433` SQLite upgrade. `db/repos/chat.ts:516-603` confirms CRUD, deduplication, ownership checks, transactional order normalization, row locking, archive cleanup and explicit membership on unarchive.
- **REST и выборки**: `routes/rest.ts:849-925,1018-1023` confirms paths, payload validation, 400/404/409 responses and filter defaults. `db/repos/chat.ts:619-759` confirms active/archive selection, scope/tenant restrictions, done/cancelled exclusions and list-only pagination.
- **Проверки**: inspected group regressions in `chatContract.test.ts:116`, `rest.conversations.test.ts:165-230`, `database.test.ts:1265` and `schemaPg.test.ts:58`. Distinguished SQLite restart coverage, sequential REST lifecycle checks and generated PostgreSQL DDL assertions.

The reviewed group/archive implementation and routes retain their behavior; unrelated changes in these broad areas do not redefine groups.

## Что выяснили (факты, которых не было в KB)

Catalog counts do not apply conversation-list filters. Unarchive can assign explicit groups in the same request. Cancelled task chats remain excluded even from archive and with includeCompleted. Conversation search has no pagination and message search does not accept groupId. PostgreSQL schema assertions do not demonstrate live transaction/race coverage.

## Куда занесено

- `docs/kb/conversation-groups.md` (existing sections; no duplicate topic).

## Открытые вопросы / что осталось

No unresolved reconciliation questions. `node scripts/kb.mjs touch conversation-groups.md`, `npm run kb:log` and `npm run kb:index` completed. `npm run kb:check` exited 0 with no stale warning for this topic (other topics still have existing freshness warnings). `npm run gate:fast` exited 0 and selected no applications/contracts for this documentation-only diff. Test coverage was inspected in source; application tests were not executed by this gate. `git diff --check` passed.
