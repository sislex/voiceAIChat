---
title: electron-cors-auth
date: 2026-09-07
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# electron-cors-auth

## Что сделано

Актуализирована тема клиентов после исправления авторизации удалённого Electron renderer через credentialed CORS и cookie-сессию.

## Что выяснили (факты, которых не было в KB)

Fastify разрешает credentialed CORS только точным origin из allowlist, а renderer восстанавливает cookie-сессию и CSRF через `/api/session/me`. Login не отправляет пароль на удалённый HTTP и различает backend-ошибки от сетевой/CORS-недоступности.

## Куда занесено

`docs/kb/clients.md`; во frontmatter добавлены server и UI transport paths для проверки свежести.

## Открытые вопросы / что осталось

Нет.
