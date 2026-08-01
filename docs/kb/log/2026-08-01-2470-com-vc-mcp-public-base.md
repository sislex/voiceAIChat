---
title: vc-mcp-public-base
date: 2026-08-01
machine: 2470-com
author: alexeyrozhnov
---

# vc-mcp-public-base

## Что сделано

- Обновлены темы `deploy`, `llm`, `server-internals` и `features/ci-runner` под новую адресацию MCP-эндпоинтов для исполнителя через `VC_MCP_PUBLIC_BASE`.
- Освежены `updated`/`checked` у затронутых тем и пересобран индекс `docs/kb/README.md`.

## Что выяснили (факты, которых не было в KB)

- Сервер больше не собирает MCP-URL для исполнителя строками `http://127.0.0.1:<PORT>...`; этим занимается `buildPublicMcpUrl()` в `apps/server/src/mcp/publicBase.ts`.
- `VC_MCP_PUBLIC_BASE` влияет сразу на три URL, которые сервер передаёт модели и CI-рану: `/mcp/remote-bash`, `/mcp/kb` и `/mcp/ci-commands`.
- Фолбэк на `http://127.0.0.1:<PORT>` сохранён намеренно для dev и Vitest, а в Docker исполнителю нужен адрес сервиса Fastify, а не его собственный loopback.

## Куда занесено

- `docs/kb/deploy.md`
- `docs/kb/llm.md`
- `docs/kb/server-internals.md`
- `docs/kb/features/ci-runner.md`

## Открытые вопросы / что осталось

- Отдельных открытых вопросов по этой задаче не осталось: адресация описана в KB, Docker-фолбэк и dev/test-поведение зафиксированы.
