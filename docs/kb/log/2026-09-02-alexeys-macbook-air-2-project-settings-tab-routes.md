---
title: project-settings-tab-routes
date: 2026-09-02
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# project-settings-tab-routes

## Что сделано

- У каждой вкладки настроек проекта — свой адрес `#/projects/:id/settings/:tab`.
  `ProjectsRoute.settings` получил необязательное поле `tab`, список
  `PROJECT_SETTINGS_TABS` и предикат `isProjectSettingsTab` экспортируются из
  `@voicechat/projects-app`.
- `ProjectSettings` стал управляемым: `activeTab`/`onTabChange` от хоста, локальное
  состояние — только без пропсов (сториз, тесты). Недоступную вкладку заменяет
  на `general` с `replace: true`.
- `App.tsx` читает вкладку из маршрута и пишет её через `buildProjectsRoute`.

## Что выяснили (факты, которых не было в KB)

- Вкладки настроек раньше жили только в `useState` компонента: ссылка на «Участников»
  или «Машины» была невозможна, а перезагрузка возвращала на «Общее».

## Куда занесено

- docs/kb/projects.md — абзац «Вкладки настроек проекта — в адресе».

## Открытые вопросы / что осталось

- Подвкладки «Настройки/Git-доступ» внутри «Машин» зависят от выбранной машины
  и в адрес не вынесены.
