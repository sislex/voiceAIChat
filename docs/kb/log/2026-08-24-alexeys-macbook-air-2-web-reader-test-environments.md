---
title: web-reader-test-environments
date: 2026-08-24
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# web-reader-test-environments

## Что сделано

- Loopback HTTP-мост машин: кадры `http.request`/`http.result`/`http.error` в `agentProtocol`, исполнитель `apps/agent/src/httpProxy.ts` (строго 127.0.0.1, кап 5 MiB, без следования редиректам), `AgentRegistry.http()` с гейтом версии `http-proxy` (агент 0.13.0).
- `/api/preview` понимает виртуальный host `<agentId>.machine.internal:<port>`: доставка агентом, доступ по `canUseAgentForPreview` (владелец или share в любом проекте пользователя), внутренние loopback-редиректы возвращаются на мост машины, внешние не следуются; общий rewrite и cookie-контейнер сохранены — логин в окружение работает.
- MCP browser: `open` разворачивает алиас `http://machine.internal:<port>` в машину разговора (`PreviewTurnContext`), новый инструмент `test-users` возвращает тестовые учётки проекта; `previewToolHint()` описывает цикл «поправь код → перезапусти dev-сервер → открой machine.internal → проверь».
- Тестовые пользователи проекта: `ProjectTestUser` + `sanitizeProjectTestUsers` (shared), колонка `projects.test_users_json`, PATCH-валидация, секция «Тестовые пользователи» в ProjectSettings (owner редактирует, участник видит read-only).
- Живая проверка: реальный компаньон-агент (tsx) + тестовый login-сервер на 127.0.0.1:15999; Reader открыл `…machine.internal:15999`, форма логина tester/test-pass прошла (POST → set-cookie → redirect), «Фича-дашборд… вы вошли как tester».

## Что выяснили (факты, которых не было в KB)

- Прецедент безопасного loopback-доступа уже был (tunnel.connect) — мост следует ему: target host фиксирован, клиент задаёт только порт.
- Cookie-контейнер превью работает для виртуальных machine-host как для обычных доменов — сессии тестовых пользователей живут между запросами без изменений в контейнере.

## Куда занесено

- docs/kb/machines.md — раздел «Loopback HTTP-мост тестовых окружений (http.request)».
- docs/kb/ui.md — раздел «Тестовые окружения проекта в Web Reader».

## Открытые вопросы / что осталось

- Feature-preview: кнопки «Тестировать в Web Reader» в карточке задачи нет; окружение открывается по machine.internal-адресу с портом из карточки.
- MCP-путь end-to-end с реальным LLM-ходом не прогонялся (покрыт юнитами previewMcp); alias резолвится по execTarget разговора — чат без машины получает подсказку выбрать её.
- HTTPS-окружения на loopback машины мост не поддерживает (только http).
