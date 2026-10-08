---
title: dev-stand-login
date: 2026-10-08
machine: delivery-b01
author: unknown
---

# dev-stand-login

## Что сделано

- Документированы вход в dev stand и расположение его рабочих файлов.

## Что выяснили (факты, которых не было в KB)

- Пользователи и пароли stand наследуются из копии production на момент её создания.
- `VC_ADMIN_PASSWORD` не меняет пароль уже существующего пользователя `admin`.
- Отдельный пароль stand задаётся scrypt-хешем только в базе stand.
- Зафиксированы каталоги manifest, gateway log, dev-процессов, worktree и base Compose.

## Куда занесено

- `docs/kb/deploy.md`, раздел «Dev stand gateway and Core component (C02)».

## Открытые вопросы / что осталось

- Нет.
