---
title: thin-desktop-gateway-lan
date: 2026-07-26
machine: 2470-com
author: server
---

# thin-desktop-gateway-lan

## Что сделано

- Desktop переведён в обязательный remote-first режим; локальные STT/TTS/LLM/IPC-модули удалены.
- После логина legacy-БД автоматически импортируется и помечается отдельно для каждого URL сервера.
- Тяжёлые terminal/markdown/QR/React зависимости вынесены в отдельные клиентские чанки.
- Добавлен авторизованный идемпотентный endpoint импорта legacy-разговоров desktop с сохранением id и дат.
- Desktop в remote-режиме больше не инициализирует локальные SQLite, STT, TTS и LLM-сервисы.
- Переключение local ↔ remote выполняется через чистый перезапуск Electron.
- Anthropic gateway ограничен loopback, RFC1918, link-local и IPv6 ULA/link-local адресами.
- За локальным Caddy учитывается исходный X-Forwarded-For; внешний peer не может подменить его напрямую.

## Что выяснили (факты, которых не было в KB)

- Тонкий renderer уже существовал, но main-процесс всё равно поднимал полный локальный backend.
- Проверка только request.ip недостаточна за Docker/Caddy: она видит локальный адрес reverse proxy.

## Куда занесено

- docs/kb/architecture.md
- apps/desktop/AGENTS.md

## Открытые вопросы / что осталось

- Перенос legacy-данных desktop в сервер и последующее удаление локального backend.
- Полный desktop-гейт после установки его отдельного node_modules и синхронизации устаревшего IPC-контракта.
- Обновление описания gateway в docs/kb/llm.md после завершения параллельных правок этого файла.
