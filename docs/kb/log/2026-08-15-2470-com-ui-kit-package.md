---
title: Выделение пакета @voicechat/ui-kit
date: 2026-08-15
machine: 2470-com
author: alexeyrozhnov
---

# Выделение пакета @voicechat/ui-kit

## Что сделано

- Записал в `docs/kb/ui.md` устройство нового workspace-пакета `packages/ui-kit`:
  публичные exports, архитектурный тест границы, гейты и то, чем перенос
  отличается от «переезда» (старые копии и стили остались на месте).
- Поправил устаревшие пути `components/ui/{Button,Dialog,useDialogStack}` в
  разделах «Кнопки» и «Модальные окна» — канонический источник теперь пакет.
- Добавил строку `packages/ui-kit` в карту монорепо корневого `AGENTS.md` и
  переписал в `packages/ui/AGENTS.md` правила «кнопка/окно/состояния» на импорт
  из `@voicechat/ui-kit`.

## Что выяснили (факты, которых не было в KB)

- Перенос сделан копированием: `packages/ui/src/components/ui/*` не удалён,
  файлы совпадают с новыми побайтово (кроме пути к `mediaQuery` и вырезанного
  `SidebarToggle`), их DOM-тесты тоже остались — примитивы и тесты задвоены.
  Живой потребитель старых копий один — `SidebarToggle` в `ProjectPage`/`ChatColumn`.
- Стили задвоены так же: `ui-kit/src/styles.css` подключён через `@import` в
  начале `packages/ui/src/styles/global.css`, но все `.vc-*` правила и токены
  остались в `app.css`, который грузится позже, — вид приложения задаёт он.
- `scripts/affected-check.mjs` про `packages/ui-kit` не знает: путь не совпадает
  ни с одной записью `PACKAGES`, поэтому правка пакета включает полный гейт.
- Симлинк `node_modules/@voicechat/ui-kit` создаётся только `npm install`: без
  него `npm run -w @voicechat/ui typecheck` падает `TS2307` на `src/test/uiRender.tsx`
  (проверено в merge-клоне).
- `mediaQuery` переехал в пакет, но из `index.ts` не экспортируется — внутренний.
- Гейты пакета: typecheck зелёный, `npm run -w @voicechat/ui-kit test` — 8 файлов,
  49 тестов, ~18 с.

## Куда занесено

- `docs/kb/ui.md` — раздел «Библиотека универсальных примитивов @voicechat/ui-kit»
  (переписан), точечные правки в разделах о `Dialog`, `useDialogStack`, кнопках.
- `AGENTS.md` (карта монорепо), `packages/ui/AGENTS.md` (состав и правила).
- Проектные статьи БЗ не трогал: изменение структурное, продуктовых сценариев
  (карточка задачи, CI-раны, сайдбар, превью, QA) оно не касается.

## Открытые вопросы / что осталось

- Удалить старые копии `packages/ui/src/components/ui/*` вместе с их тестами и
  вынести `SidebarToggle` на импорт `IconButton` из пакета.
- Убрать дублирование `.vc-*` правил и токенов из `app.css` или явно закрепить,
  что боевой источник — он.
- Добавить `packages/ui-kit` в `PACKAGES` в `scripts/affected-check.mjs`, чтобы
  правка примитивов не поднимала полный гейт.
