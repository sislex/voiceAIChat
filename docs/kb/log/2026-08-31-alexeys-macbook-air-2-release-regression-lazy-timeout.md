---
title: release-regression-lazy-timeout
date: 2026-08-31
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# release-regression-lazy-timeout

## Что сделано

- Разобран упавший шаг Regression релиза: из 2652 тестов упал один —
  `App.projects.dom.test.tsx` «вкладки меняют только содержимое».
- В `packages/ui/src/test/setup.ts` задан `configure({ asyncUtilTimeout: 5000 })`.

## Что выяснили (факты, которых не было в KB)

- Симптом в логе шага: вместо `project-settings` в DOM висел
  `<div role="status">Загрузка настроек проекта…</div>` — то есть `Suspense`-fallback
  ленивого `ProjectSettings`, а не сломанный экран.
- Причина: `asyncUtilTimeout` Testing Library = 1 с по умолчанию. Изолированно
  тест проходит за ~900 мс, то есть запас меньше сотни миллисекунд; на полном
  прогоне (тесты 718 с суммарно, параллельные наборы) его не хватает.
- `testTimeout: 20000` в `packages/ui/vitest.config.ts` этот класс падений не
  лечит: он ограничивает тест целиком, а не отдельное ожидание `findBy*`.
- Regression релиза выполняется на машине агента (в логе путь
  `/Users/alexeyrozhnov/chatAI/projects/<id>/worktree.voicechat-regression-<release>`),
  то есть под той же нагрузкой, что и остальная работа на ноутбуке.
- Воспроизвести шаг можно локально: `git worktree add --detach <dir> origin/main`,
  затем `npm ci` и тест-команда проекта в этом каталоге — окружение основного
  чекаута при этом не затрагивается.

## Куда занесено

- docs/kb/testing-operations.md — абзац про `findBy*` и ленивые чанки.

## Открытые вопросы / что осталось

- Прод-хост по SSH недоступен (`Permission denied (publickey,password)`), лог
  шага доступен только через Release Center — брать его приходится у человека.
