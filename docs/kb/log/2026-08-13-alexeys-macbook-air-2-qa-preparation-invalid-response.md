---
title: qa-preparation-invalid-response
date: 2026-08-13
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Устойчивость QA Preparation к невалидному ответу LLM

## Что сделано

Проверено и зафиксировано текущее поведение подготовки сценариев: строгий контракт ответа, полная валидация до сохранения, одна автоматическая повторная попытка, явный terminal failure и ручной безопасный retry.

## Что выяснили (факты, которых не было в KB)

Состояние последнего preparation-run входит в QA state и после reload отображается как `running`, `success` или `failed`. Сервер при старте переводит оставшиеся `running`-раны в `failed`, а UI показывает причину и действие повторного запуска для той же пары task/SHA.

## Куда занесено

`docs/kb/features/manual-qa.md`, раздел «Место в workflow».

## Открытые вопросы / что осталось

Нет.
