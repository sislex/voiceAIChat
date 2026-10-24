---
title: identity-signup-error-coverage
date: 2026-10-24
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# identity-signup-error-coverage

## Что сделано

Сверено и сохранено актуальное покрытие ошибок регистрации Identity.

## Что выяснили (факты, которых не было в KB)

На Identity `3a66930564c3bb2baebfc8d3e85a04d15867fa41` тесты проверяют
15 комбинаций нестроковых значений name/email/password. При закрытой регистрации
проверяется отсутствие cookie и response token. Почтовый ящик в этих тестах
перехватывается в памяти и не подтверждает SMTP-приёмку.

## Куда занесено

- docs/kb/data-auth.md

## Открытые вопросы / что осталось

SMTP-приёмка на неизменяемом стенде остаётся отдельным доказательством.
