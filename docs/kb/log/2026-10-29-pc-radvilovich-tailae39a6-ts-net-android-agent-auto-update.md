---
title: android-agent-auto-update
date: 2026-10-29
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# android-agent-auto-update

## Что сделано

- Зафиксировано автоматическое предложение обновления Android-агенту со стороны Core.
- Зафиксирован owner-side контракт Android supervisor и сохранение self-updated bundle при обновлении APK.

## Что выяснили (факты, которых не было в KB)

- Core отправляет `agent.update` только более старым supervised-агентам и не чаще одного раза за соединение.
- Android регистрируется с `supervisor: android`; APK не затирает установленный self-update и откатывает неподтверждённое обновление через 90 секунд.

## Куда занесено

- `docs/kb/server-internals.md`
- `docs/kb/machines.md`

## Открытые вопросы / что осталось

- Нет.
