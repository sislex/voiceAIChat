---
title: vendor-archives-out-of-git
date: 2026-10-18
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# vendor-archives-out-of-git

## Что сделано

- Закреплённые архивы владельцев вынесены из git в публичный релиз `vendor` репозитория sislex/voiceAIChat
  (29 ассетов, байты сверены). `package.json`/`package-lock.json` ссылаются на URL ассета; integrity в lock не менялась.
- `scripts/vendor-store.mjs` (`npm run vendor:fetch|publish|check`): загрузка с кэшем и проверкой sha256/integrity,
  публикация недостающих архивов, запрет `*.tgz` в git. `vendor/*.tgz` в `.gitignore`.
- Инструменты пинов принимают обе формы ссылки; `release-composition apply` и `contracts-release` публикуют новые
  архивы в релиз до обновления lock; A07, shared-chat-artifacts, owner-release-publish `--from-core`, пример E02
  берут байты через vendor-store. `.npmrc`: 5 повторов загрузки.

## Что выяснили (факты, которых не было в KB)

- `.git` Core весил ~866 МБ: 272 версии архивов (834 МБ) в истории; большие клоны рвались на GitHub
  (`fetch-pack: unexpected disconnect`).
- Ассеты GitHub-релизов владельцев не совпадают по байтам с закреплёнными в Core (другие сборки) — поэтому
  хранилище собственное, а не ссылки на релизы владельцев.
- `npm install --package-lock-only` в Core падает на давнем peer-конфликте `@sislexa/component-runtime`
  (image-studio 1.1.2 требует >=1.0.1 <2.0.0); правки lock делать точечно.

## Куда занесено

- docs/kb/deploy.md, vendor/README.md, AGENTS.md (Commands).

## Открытые вопросы / что осталось

- Переписать историю (git filter-repo) и force-push — отдельным шагом владельца/оператора.
