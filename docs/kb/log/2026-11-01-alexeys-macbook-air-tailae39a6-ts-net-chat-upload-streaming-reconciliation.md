---
title: chat-upload-streaming-reconciliation
date: 2026-11-01
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# chat-upload-streaming-reconciliation

## Что сделано

Сверены с merge-кодом три обязательных пробела о формах chat upload,
границах буферизации Core и атомарности потоковой записи. Дополнены существующие
темы без создания дублирующей статьи.

## Что выяснили (факты, которых не было в KB)

Все формы проходят общие auth, conversation/tenant и rate-limit проверки, а
storage-вариант требует conversationId. Machine и локальный fallback буферизуют
ограниченный поток, но base64 появляется только в вызове AgentRegistry.fsWrite.
Multipart считается завершённым лишь после проверки truncation и отсутствия
второй части; только затем координатор может зафиксировать metadata.

## Куда занесено

Формы и общие проверки уточнены в docs/kb/protocol.md, границы Core и отсутствие
новой конфигурации — в docs/kb/server-internals.md, транзакция и cleanup — в
docs/kb/data-auth.md.

## Открытые вопросы / что осталось

Переключение Core UI на новый transport остаётся отдельной owner-задачей.
