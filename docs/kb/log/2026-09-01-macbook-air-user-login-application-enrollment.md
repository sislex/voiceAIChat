---
title: login-application-enrollment
date: 2026-09-01
machine: macbook-air-user
author: voicechat-ci
---

# login-application-enrollment

## Что сделано

Описаны отдельное macOS ARM64 login-application, серверный выпуск и погашение одноразового enrollment, а также общий UI guard для действий, которым нужна машина.

## Что выяснили (факты, которых не было в KB)

Enrollment-секрет живёт две минуты, хранится на сервере только как SHA-256 и погашается транзакционно. Постоянный machine token не попадает в deep link и сохраняется приложением через Electron safeStorage. После завершения сервер назначает новую машину персональной default, а UI ждёт её online-состояния, обновляет список без перезагрузки и ровно один раз продолжает отложенное действие.

## Куда занесено

- docs/kb/machines.md
- docs/kb/clients.md

## Открытые вопросы / что осталось

Нет.
