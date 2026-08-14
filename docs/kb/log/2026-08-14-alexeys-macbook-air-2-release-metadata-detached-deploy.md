---
title: release-metadata-detached-deploy
date: 2026-08-14
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# release-metadata-detached-deploy

## Что сделано

- Актуализированы темы деплоя и защищённых релизов: зафиксирован явный перенос канонической версии и её источника через стабильный launcher и detached `deploy.sh`.
- Обновлены метки свежести тем и производный индекс базы знаний.

## Что выяснили (факты, которых не было в KB)

- `ReleaseManager` передаёт проверенную версию ветки как `VC_RELEASE_VERSION` и помечает источник `release-manager`; ожидаемые version/commit видны в логах до длительного health-check.
- Первый проход `deploy.sh` сериализует version/source в аргументы `setsid nohup`, а detached-процесс восстанавливает их до deploy-lock, Git и Compose. Обычный деплой использует только строгий тег текущего HEAD либо публикует `version: null`.
- После рестарта сервера активная попытка в `building`/`health_check` возобновляет ожидание сохранённых version и commit без повторного production deploy.

## Куда занесено

- `docs/kb/deploy.md` — путь release metadata, fallback по Git-тегу и диагностический source.
- `docs/kb/features/releases.md` — контракт ReleaseManager, health-check и восстановление после рестарта.
- Статья «Пересборка прода: сначала проверить, потом собирать» — различие обычной пересборки и защищённой публикации, проверка health metadata.

## Открытые вопросы / что осталось

- Открытых вопросов по зафиксированному поведению нет.
