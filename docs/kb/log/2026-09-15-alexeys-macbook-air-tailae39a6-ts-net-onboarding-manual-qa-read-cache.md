---
title: onboarding-manual-qa-read-cache
date: 2026-09-15
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# onboarding-manual-qa-read-cache

## Что сделано

- Сверены с рабочим кодом и описаны мастер первого запуска, сохранение draft в цикловом ручном QA и общий кэш маршрутных чтений.

## Что выяснили (факты, которых не было в KB)

- Onboarding восстанавливает прерванный `checking` как предупреждение, выполняет побочные эффекты только по явному действию и изолирует диагностический WS от чата.
- `NewTaskManualQaPanel` держит локальный draft через refresh и ошибку сохранения, очищая его только после успешного save.
- Identity записи `ReadCache` не позволяет позднему HTTP-ответу затереть результат invalidate или realtime seed.

## Куда занесено

- `docs/kb/stt-tts.md`
- `docs/kb/features/manual-qa.md`
- `docs/kb/ui.md`

## Открытые вопросы / что осталось

- Нет.
