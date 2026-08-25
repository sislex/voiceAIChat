---
date: 2026-08-26
machine: alexeys-macbook-air-2
slug: reader-layout-and-diagnostics
---

# Вёрстка ридеров, проект в Playwright, самодиагностики

По запросу пользователя (Web Reader / Playwright Reader):

**Вёрстка.** Композер больше не схлопывается в узкой reader-колонке: `.voicebar`
объявлен `container: composer / inline-size`, компакт-режим включается по
`@container composer (max-width: 560px)` (а не только по мобильному вьюпорту).
`.chat-split-chat` держит `min-width: 360px`, превью-панели стали сжимаемыми
(`flex: 0 1 var(--preview-width); min-width`). Заголовок шапки `.mtitle` — одна
строка с многоточием. Тулбар веб-рекордера (`Recorder.tsx`) собрал инструменты
страницы в свёрнутое `<details className="webpreview-tools">`-меню + `flex-wrap`
на `.webpreview-bar` (кнопки остаются в DOM, dom-тесты рекордера не тронуты).

**Проект в Playwright Reader.** Снят серверный запрет в `database.setConversationProject`
(`assistantKind === 'playwright-reader' && projectId !== null → null`). Клиентский
`chatStore.setConversationProject` теперь обновляет запись и в reader-/playwright-списках.

**Самодиагностики.** Новый чистый модуль `playwrightReaderDiagnostics.ts` (мост
`window.browser`: bridge → start → meta → screenshot → reload; проверки не уводят
страницу) + кнопка в настройках (`playwrightReaderDiagnostics` при `inPlaywrightReader`)
и команда `/playwright-reader-diagnostics`. Чат-диагностика (`chatDiagnostics`)
получила кнопку в настройках обычного чата (была только команда).

Гейты: typecheck целиком, ui 1791+2, web-recorder 21, chat-app, server projects 86,
web/storybook/recorder build — зелёные.
