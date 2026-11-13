---
title: release-train-from-dev-kb
date: 2026-10-27
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# release-train-from-dev-kb

## Что сделано

- Дополнен раздел Release train execution ссылками на файлы-источники быстрого пути из dev.

## Что выяснили (факты, которых не было в KB)

- `--from-dev` хранится в журнале, выбирает quick-гейты и dev-push без PR в main; Release Center обязан подтвердить `fast: true`, иначе train останавливается.

## Куда занесено

- `docs/kb/deploy.md` — раздел Release train execution (C01).

## Открытые вопросы / что осталось

- Первый операторский быстрый выкат должен совместно проверить Core и поддержку fast-релиза в Release Center.
