# followup-fixes-v2 — карточки внешних задач на доске

Ран `followup-fixes-v2`. Ветка задач — `dev`.

Владелец, 2026-10-09: недочёты, найденные при проверке канбана на проде, — задачами на воркерах.

| B01 | core-ui | — | External task cards are unreadable on the board. `ExternalTaskCard` in `packages/ui/src/modules/projects/components/kanban/ExternalTask.tsx` renders `task.title` inside `<Button variant="ghost">`; the ui-kit button does not wrap and centres its label, so a long Delivery Control title («stand-smoke-v1 · C02: Tests for the dev launcher's environment checks.») overflows the 260 px card on both sides (measured on production: label scrollWidth 1771 px vs 232 px visible) and only the middle of the text is visible. Render the title as a card title like ordinary task cards (left-aligned, wrapping by words, clamped to a few lines with ellipsis, full title in `title`/`aria-label`), still opening the details on click and keyboard (Enter/Space) with a visible focus state; keep «Источник: … · Открыть в источнике» and clamp the description so it never widens the card. Nothing inside the card may overflow horizontally at 260 px card width or on a 360 px phone. Add DOM tests (long unbreakable and long multi-word titles: no horizontal overflow, click/keyboard open details) next to the existing kanban card tests. Gate: `npm run gate:task -- --base <sha>`. |
