---
title: managed-ci-workspace-bootstrap
date: 2026-08-22
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# managed-ci-workspace-bootstrap

## Что сделано

- Актуализировано описание bootstrap и повторного использования CI workspace при managed MachineStorage.

## Что выяснили (факты, которых не было в KB)

- Bootstrap идёт из корня MachineStorage, создаёт managed layout и npm-кэш до clone; готовность checkout определяется проверкой Git.
- Чистый checkout переиспользуется, dirty завершается с exit 66, непустой не-Git каталог — с exit 65; без MachineStorage действует legacy reposRoot.

## Куда занесено

- docs/kb/features/ci-runner.md

## Открытые вопросы / что осталось

- Нет.
