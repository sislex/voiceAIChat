---
title: context-snapshot-effective-llm
date: 2026-08-25
machine: macbook-air-user
author: NikolayTola
---

# context-snapshot-effective-llm

## Что сделано

- Дополнено описание серверного снимка контекста разговора и effective LLM.

## Что выяснили (факты, которых не было в KB)

- Снимок выбирает пару provider/model по цепочке «разговор → проект → пользователь» и одинаково использует её в summary и элементе llm.
- source/explanation элемента llm явно показывают уровень, с которого взята конфигурация.

## Куда занесено

- docs/kb/server-internals.md

## Открытые вопросы / что осталось

- Нет.
