---
title: stand-users-password
date: 2026-10-18
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# stand-users-password

## Что сделано

- Настройка окружения `VC_STAND_USERS_PASSWORD`: при развёртывании стенда всем пользователям (и admin) ставится
  этот тестовый пароль (scrypt), без принудительной смены, TOTP сброшен. Без настройки — прежнее поведение.

## Что выяснили (факты, которых не было в KB)

- Скрипт стенда маскирует значения всех настроек в журнале стадий; короткое публичное значение исключено из маскировки.

## Куда занесено

- docs/kb/deploy.md (Login and locations on the stand machine).

## Открытые вопросы / что осталось

- Kanban передаёт ключ в stand.env (отдельный PR в sislexa-kanban).
