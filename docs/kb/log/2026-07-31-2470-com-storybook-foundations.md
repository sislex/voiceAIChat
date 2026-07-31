---
title: storybook-foundations
date: 2026-07-31
machine: 2470-com
author: alexeyrozhnov
---

# storybook-foundations

## Что сделано

- Раздел `Foundations` в Storybook (`packages/ui/src/stories/foundations/`): `Colors`
  (все токены обеих тем + контраст семантических пар), `Spacing & Radius`,
  `Typography`, `Icons`, `CI Status` и docs-страница `AddingComponent.mdx`
  «Как добавлять компонент».
- Помощники витрины: `tokens.ts` (обход `document.styleSheets`, зонды под
  `getComputedStyle`, математика WCAG), `typeScale.ts` (шкала кеглей/весов из
  правил `app.css`), `parts.tsx` (общая обвязка) и тест `tokens.test.ts` на
  контраст и разбор цвета.
- `.storybook/preview.tsx`: фон и цвет `body` тянутся к `--bg`/`--text`, `.app`
  переведён в обычный поток (иначе длинные таблицы обрезались), отключён аддон
  фонов, добавлен `storySort` (Foundations впереди). `main.ts` — глоб `*.mdx` и
  поднятый `chunkSizeWarningLimit`.

## Что выяснили (факты, которых не было в KB)

- В `app.css` три селектора (`[data-theme='dark'] .cstatus-select:hover/:focus`,
  `.side-collapse:hover`) остались без блока объявлений после переезда кнопок на
  `Button` (ушёл `.footico-btn`). Невалидное правило утягивало следующий
  `@media (min-width: 769px)` — стили **свёрнутого сайдбара на десктопе просто не
  применялись**, и esbuild ругался на этом месте при сборке витрины. Починено,
  фон взят токеном `--surface-hover`.
- `--text-dim` в светлой теме не проходит AA: 3.44:1 на `--bg`, 3.60:1 на
  `--surface`, 3.18:1 на `--panel`. То же самое axe находит на сториз канбана и
  кнопок — проблема палитры, а не витрины. В тёмной теме все пары проходят.
- Лозенги в светлой теме: `--ci-neutral` — 4.05:1, `--ci-progress` — 3.71:1 на
  своих подложках при кегле 11px, то есть ниже AA.
- `GearIcon` рисуется прошитым `#55534A` вместо `currentColor` и в тёмной теме не
  светлеет; витрина `Foundations/Icons` находит такие иконки сама (обход
  атрибутов `fill`/`stroke`).
- Storybook-сборка чиста, кроме двух предупреждений про `eval` внутри
  `@storybook/core` — это чужой рантайм, убрать нельзя.

## Куда занесено

- `docs/kb/ui.md` — раздел «Витрина Storybook».
- `packages/ui/AGENTS.md` — абзац про Storybook: раздел Foundations и правило
  «токены читаются из CSS, а не дублируются в TS».

## Открытые вопросы / что осталось

- Решить, править ли палитру: `--text-dim` и светлые лозенги CI ниже AA. Это
  меняет вид всего приложения, поэтому не делалось в рамках задачи.
- `GearIcon` перевести на `currentColor` (одна правка, но меняет вид шапки — тоже
  отдельным решением).
