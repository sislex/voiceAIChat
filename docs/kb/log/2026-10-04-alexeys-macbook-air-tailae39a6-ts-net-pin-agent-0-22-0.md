---
title: pin-agent-0-22-0
date: 2026-10-04
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# pin-agent-0-22-0

## Что сделано

- Закреплён агент 0.22.0 (контракты 1.2.0): Tailscale-адрес и имя узла в телеметрии, привязка порта к VPN
  (environments-v4 C22). Опубликован `owner-release-publish.mjs --source`, закреплён вручную в четырёх
  `package.json` (агента нет в реестре), lock обновлён.
- `VC_VPN_SECRET_KEY` передаётся в сервисы `voicechat` и `machines` из `.env` прода.

## Что выяснили (факты, которых не было в KB)

- Compose не передавал `VC_VPN_SECRET_KEY` в ядро, поэтому VPN машин на проде не мог работать вообще.
- `owner-release-publish.mjs --source` для агента запускает только `pack:release`: без предварительного
  `npm run build` архив выходит без `dist/` (`GET /api/agents/script` → 500). Первый v0.22.0 был таким,
  его удалили и перевыпустили после сборки (архив `5e914378a898`).
- Контракты 1.2.0 требуют `hostName` в наблюдении VPN.

## Куда занесено

- docs/kb/deploy.md — хранение секретов окружений и VPN.

## Открытые вопросы / что осталось

- Ключ в `.env` прода, подключение сети Tailscale владельцем, обновление агентов, U04.
