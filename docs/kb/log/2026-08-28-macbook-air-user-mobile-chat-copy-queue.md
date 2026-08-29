---
title: mobile-chat-copy-queue
date: 2026-08-28
machine: macbook-air-user
author: NikolayTola
---

# mobile-chat-copy-queue

## Что сделано

- Сверены изменения мобильного чата, копирования сообщений и подтверждения pendingSubmit с кодом и diff относительно main.
- Дополнена тема UI, обновлены свежесть темы и производный индекс.

## Что выяснили (факты, которых не было в KB)

- До HTTP-ответа обычная отправка подтверждается chat.message по conversation, пользовательской роли и полному messageText, а очередь — claude.queue по тексту, позиции и упорядоченным attachment id.
- Поздний HTTP-ответ изолирован operationId и не затрагивает следующую pending-операцию.
- Копирование пользовательских и AI-сообщений использует полный m.text; успех показывается только при true, Clipboard API имеет execCommand fallback.
- Мобильные шапка и однострочный VoiceBar уплотнены, сохраняя safe-area, auto-grow, полноэкранный textarea и desktop layout.

## Куда занесено

- docs/kb/ui.md

## Открытые вопросы / что осталось

- Нет.
