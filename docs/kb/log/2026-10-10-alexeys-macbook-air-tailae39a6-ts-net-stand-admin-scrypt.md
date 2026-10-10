---
title: stand-admin-scrypt
date: 2026-10-10
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# stand-admin-scrypt

## Что сделано

- Санитизация копии прода для стенда пишет администратору scrypt-хэш (формат Identity) вместо bcrypt
  из pgcrypto; тест с вектором node:crypto; описан способ смены пароля пользователя на стенде.

## Что выяснили (факты, которых не было в KB)

- На стендах не подходил ни один пароль: все пароли копии обнулены, а хэш администратора был в формате
  bcrypt (`$2a$`), который `verifyPassword` Identity не принимает. KB ошибочно утверждала, что пароли прода
  на стенде действуют. Маршрут входа — `POST /api/session/login` с полями `{name, password}`.

## Куда занесено

- docs/kb/deploy.md#managed-stands

## Открытые вопросы / что осталось

- На действующем стенде dev-base-m2 пароль admin задаёт владелец скриптом `sislexa-stand-password`.
