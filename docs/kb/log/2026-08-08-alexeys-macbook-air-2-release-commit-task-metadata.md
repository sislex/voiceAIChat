---
title: release-commit-task-metadata
date: 2026-08-08
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# release-commit-task-metadata

## Что сделано

- Дополнена тема деплоя сведениями о Git-коммите и задаче в метаданных версии.

## Что выяснили (факты, которых не было в KB)

- Prod-скрипты передают 12-символьный SHA и нормализованную задачу через compose; health возвращает nullable-поля, а UI показывает только имеющиеся значения в подсказке версии.

## Куда занесено

- docs/kb/deploy.md

## Открытые вопросы / что осталось

- Нет.
