---
title: tests-wave1-release-only
date: 2026-11-09
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# tests-wave1-release-only

## Что сделано

- Сьюты `e2e/projects.e2e.test.ts` и `e2e/gitPane.e2e.test.ts` (стенд Postgres + Core + Kanban + Chromium) убраны из гейтов разработки и оставлены только в `gate:release` (`test:browser:release`, `gate:all -- --release`, `releaseE2eFiles` в плане). В разработке запускаются, только если правится сам файл сьюта.
- Стенд канбана проверяет готовность Postgres запросом по TCP через опубликованный порт; `beforeAll` сьюта проектов получил 180 с.
- `gate:all` в разработке гоняет `test:tooling:dev` и тесты изменённых скриптов (`relatedTooling`); полный `test:tooling` — в релизе и при недоказуемом diff.
- `apps/server/src/session.test.ts`: удалён дубль `chat message synchronization`, фиксированные паузы заменены на барьеры и `vi.waitFor`, общий сервер строится один раз на тест.

## Что выяснили (факты, которых не было в KB)

- Тест a07 импортирует код сервера, поэтому `relatedTooling` по всем изменённым файлам выбрал бы его почти всегда; связанные тесты выбираются только по изменённым файлам `scripts/`.

## Куда занесено

- docs/kb/testing-operations.md — раздел «Development and release scope of the full gate».

## Открытые вопросы / что осталось

- Аттестация `verified/full-gate` теперь означает dev-объём `gate:all`; сьюты канбана в узком режиме релиза запускаются только если их выбрал diff.
