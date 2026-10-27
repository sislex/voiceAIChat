---
title: dev-stand-local
date: 2026-10-25
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Изолированный локальный стенд `npm run dev:stand`

## Что сделано

- `scripts/dev-stand-local.mjs` и команды `dev:stand`, `dev:stand:status`, `dev:stand:stop`: полная копия Sislexa без Docker — свои рабочие копии, порты, база, данные, логи и секреты; внешний только LLM Runner из явного файла.

## Что выяснили (факты, которых не было в KB)

- Dev-процессы компонентов должны сообщать `VC_APPLICATION_COMMIT` (полный SHA) и версии API/данных, иначе Core отвергает зависимость.
- Identity и Core должны делить секрет сессий, иначе ходы падают с «восстановить исходную сессию входа».
- Kanban ходит в Core по служебному токену: в `legacyScopes` ядра нужны `kanban.core|events|exec`.
- Превью Make другого экземпляра подключается через thin-client окружение, указывающее на Core стенда; Make правит только Core UI.

## Куда занесено

- docs/kb/deploy.md, раздел «Isolated local stand without Docker».

## Открытые вопросы / что осталось

- Серверные компоненты стенда не правятся из Make: thin-client стенд поддерживает только `core-ui`.
