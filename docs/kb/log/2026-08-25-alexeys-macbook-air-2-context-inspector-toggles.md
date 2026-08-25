---
title: context-inspector-toggles
date: 2026-08-25
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# context-inspector-toggles

## Что сделано

- «Контекст и инструкции»: к существующему read-only инспектору контекста
  (context-snapshot) добавлены тумблеры включения/выключения пунктов и реальный
  гейтинг — выключенное не попадает ассистенту в следующих ходах.
- shared: `ContextSnapshotItem` получил `toggleable`/`enabled`; новый модуль
  `contextGating.ts` (`isContextToggleable`, `toolNameForContextId`,
  `skillNameForContextId`, SAFETY/INFO id-списки); `LlmRequest.disallowedTools`.
- server: колонка `conversations.disabled_context_json` (+ миграция), маппинг и
  `setConversationContextEnabled` (безопасность выключить нельзя); снимок помечает
  toggleable/enabled и гасит includedInNextTurn у выключенного; роут
  `POST /api/conversations/:id/context/:itemId`. Применение в turns.ts:
  personalization/project-binding/knowledge-mode → убрать блок (kb → off),
  skill-<name> → effectiveSkills, mcp-* → disallowedTools. claudeCli: единый
  `--disallowedTools` (Bash + выключенные) и фильтр allow-list.
- ui: `ContextInspector` — чекбоксы у выключаемых пунктов, замок у неотключаемых,
  переключатель в detail; мост `conversations:setContextItem`.
- Гейты: shared 557, server 1302, ui 1778, runner 76, web build, typecheck всего.

## Что выяснили (факты, которых не было в KB)

- «Правила платформы/VoiceChat» — это и есть безопасность: полный текст закрыт
  (снимок отдаёт безопасные метаданные), выключить нельзя.
- AGENTS.md читает сам CLI из cwd — сервер его не вставляет в промпт, поэтому
  гейтить его серверно нельзя; пункт остаётся информационным.
- claude `--disallowedTools` принимается один раз — Bash и выключенные MCP
  собираем в один список, иначе флаг перетёрся бы.

## Куда занесено

- docs/kb/ui.md — абзац «Тумблеры контекста (гейтинг)» в разделе инспектора.

## Открытые вопросы / что осталось

- codexCli пока не получает disallowedTools (у codex нет прямого аналога) —
  для codex гейтятся только текстовые блоки и kb-режим, не отдельные MCP-инструменты.
- Полный текст каждого AGENTS.md/навыка инспектор не раскрывает (безопасность:
  файлы читаются только по отдельному подтверждённому запросу).
- История в промпте показывается счётчиком; точный текст «что ушло модели» — в MessageMeta.
