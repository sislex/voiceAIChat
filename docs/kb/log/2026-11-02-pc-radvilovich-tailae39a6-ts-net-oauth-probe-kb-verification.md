---
title: oauth-probe-kb-verification
date: 2026-11-02
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# oauth-probe-kb-verification

## Что сделано

- Сверены с merge SHA OAuth fixture regression и runtime session bootstrap.
- Обновлена свежесть тем data-auth и server-internals; индекс перегенерирован.

## Что выяснили (факты, которых не было в KB)

- Subject-token fixture lookup использует полный подписанный JWT как ключ.
  Повторный расчёт exp на границе секунды менял ключ, и exchange stub создавал
  токен без sub; pinned auth client отклонял его, а probe отвечал Storage 503.
- Core регистрирует OAuth до global auth guard. Исключённые из guard session
  routes вызывают OAuth adapter явно; storageToken меняет access token текущего
  аутентифицированного запроса на аудиторию storage.

## Куда занесено

- docs/kb/data-auth.md, Identity OAuth mode.
- docs/kb/server-internals.md, Identity OAuth session bootstrap.

## Открытые вопросы / что осталось

- Нет.
