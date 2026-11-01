---
title: release-train-resume-core-refresh
date: 2026-11-01
machine: pc-radvilovich-tailae39a6-ts-net
author: unknown
---

# release-train-resume-core-refresh

## Что сделано

- Перед Core gate добавлено обновление приватного checkout: fetch и rebase pin-коммита на свежий `origin/dev`.
- Добавлена очистка непривязанных незатреканных `vendor/*.tgz` и отчёт об обновлении зависимостей.
- Добавлен regression-тест resume после конкурентного Core UI pin.

## Что выяснили (факты, которых не было в KB)

- Журнал может уже считать pin завершённым, поэтому обновление должно выполняться непосредственно перед gate, а не только в pin-step.

## Куда занесено

- `docs/kb/deploy.md` — Release train execution (C01).

## Открытые вопросы / что осталось

- Нет.
