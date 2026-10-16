# kanban-owners-v1 — задачи канбана на несколько репозиториев не теряют работу модели

Ран `kanban-owners-v1`. Ветка задач — `dev`. Задачу выполняют воркеры MacBook (M2); M1 выключен.

## Что случилось

2026-10-15 две карточки канбана проекта Sislexa (SISL-735, SISL-736) после успешной работы модели вернулись в
«Готово к разработке», а их запуски умирали за 2 секунды. В журнале шага «Подготовка рабочей директории» (и шага
«Отправить ветку задачи в origin» у SISL-735):

```
Вложенный Git-репозиторий запрещён: .owner-checkouts/core-ui/.git
<корень>/.owner-checkouts/kanban
Переместите owner checkout в <storage>/projects/<id>/tasks/<id>/owners/<owner>/repository и повторите запуск;
данные автоматически не удаляются.
```

Задачи затрагивали несколько репозиториев, и модель клонировала чужие репозитории внутрь рабочей копии задачи
(`.owner-checkouts/<owner>`, `.task-repositories/<owner>`, запись в `.git/info/exclude`), сделала в них коммиты
(`core-ui` 22 файла, `kanban` 11 файлов для SISL-736; `kanban` 6 файлов для SISL-735) и никуда их не отправила:
шаг отправки пушит только ветку задачи основного репозитория. Следующий запуск отказывается работать с вложенным
репозиторием, перенос в `owners/<owner>/repository` никто не делает, причина в карточке не видна, автопилот гоняет
запуск по кругу. Оператор достал коммиты руками и отправил ветки `SISL-736` в `sislex/sislexa-kanban` и
`sislex/sislexa-core-ui`, `SISL-735` в `sislex/sislexa-kanban`.

## Задачи интегратора (Claude, вне манифеста)

- После приёмки: выпуск Kanban, закрепление в Core, релиз Core и деплой; проверка на карточке с двумя
  репозиториями на машине MacBook.

| B01 | Kanban | — | Keep multi-repository task work instead of refusing it, per docs/plans/kanban-owners-v1.md «Что случилось»: (1) in the working-directory preparation step, when a nested Git repository is found inside the task working copy (`.owner-checkouts/<owner>`, `.task-repositories/<owner>` or any directory with its own `.git` that is not a submodule), move it to `tasks/<id>/owners/<owner>/repository` (owner resolved from its `origin` URL against the known repositories) and continue, instead of exiting with code 66; (2) the model gets an explicit instruction in its task brief/system prompt to put checkouts of other repositories only under that owners directory and never inside the task working copy; (3) the «push task branch» step also pushes every owner repository under `owners/*/repository` that has commits ahead of its base to a branch named after the task (`SISL-<n>`) in its own origin, records those branches in the run report and in the card, and fails loudly only when a push is rejected; (4) when a before-model step fails twice in a row for the same reason, the card goes to the decision column with the step tail as the reason instead of returning to ready; (5) tests for the move, the owner push and the decision routing; update the KB topic of the CI run. |
