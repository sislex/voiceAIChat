---
title: web-reader-user-like-cycle-01
date: 2026-09-14
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# web-reader-user-like-cycle-01

## Что сделано

- Цикл 01 серии «Web Reader: браузер как у пользователя» (`docs/plans/web-reader-user-like-browsing-20-cycles.md`):
  10 улучшений инструментов модели (field/role/append/onScreen/to: element/wait state/repeat/navigated/title/хинт)
  и 10 улучшений панели для десктопа и телефона (живой статус действия, точка на вкладке, заголовок,
  индикатор загрузки, 44 px цели, чип вьюпорта, копирование/внешняя вкладка, недавние адреса, Alt+стрелки,
  клавиатурный разделитель).
- Гейт модуля: shared 1084, web-reader 426, web-recorder 174, web-reader-app 99, browser-runner 845,
  ui `readerSplitControls` + `App.dom` 78 — зелёные по коду возврата; typecheck затронутых пакетов зелёный.
- Проверка в Chrome на локальном стенде (`localhost:5303`): заголовок страницы и живой открытый сайт видны.

## Что выяснили (факты, которых не было в KB)

- Стенд из Claude Code нужно поднимать без переменных `CLAUDECODE`/`CLAUDE_CODE_*`; профиль CLI пользователя
  в runner не залогинен («Not logged in · Please run /login»), для живых ходов модели включать
  `VC_CODEX_SHARED_AUTH=true` и переводить разговор на Codex.
- Соседний чекаут `voiceAIChat1` держит шлюз `127.0.0.1:8802` для ветки Codex; cookie общие на host,
  поэтому локальный стенд открывается по `localhost`, а не по `127.0.0.1`.

## Куда занесено

- docs/kb/ui.md — разделы «Живые действия и безопасность Web Reader» и «Действия модели в превью».
- docs/plans/web-reader-user-like-browsing-20-cycles.md — таблицы цикла и описание стенда.

## Открытые вопросы / что осталось

- Живой ход модели через панель проверить после переключения разговора на Codex (см. следующий цикл).
- Циклы 02–20.
