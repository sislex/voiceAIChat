---
title: adaptive-voicebar-attachments
date: 2026-08-24
machine: macbook-air-user
author: NikolayTola
---

# adaptive-voicebar-attachments

## Что сделано

- Сверены с рабочей копией адаптивные позиции VoiceBar, expanded-редактор и lifecycle локальных вложений.

## Что выяснили (факты, которых не было в KB)

- Новый пустой чат использует centered-композер, разговор — docked; expanded сохраняет DOM textarea, фокус и selection.
- Локальные вложения проходят processing/ready/error, блокируют submit до готовности и освобождают Object URL после удаления либо успешной отправки.

## Куда занесено

- docs/kb/ui.md

## Открытые вопросы / что осталось

- Нет.
