---
title: windows-install-command-cmd
date: 2026-07-27
machine: 2470-com
author: server
---

# windows-install-command-cmd

## Что сделано

- Исправлена Windows-команда установки агента: теперь она корректно вставляется и в cmd.exe, и в PowerShell.
- Добавлен точный unit-тест итоговой однострочной команды.

## Что выяснили (факты, которых не было в KB)

- cmd.exe не считает одинарные кавычки ограничителями аргумента `powershell -Command`.
- Для совместимости двух оболочек команда использует внешние двойные кавычки и не содержит `---
title: windows-install-command-cmd
date: 2026-07-27
machine: 2470-com
author: server
---

# windows-install-command-cmd

## Что сделано

- Исправлена Windows-команда установки агента: теперь она корректно вставляется и в cmd.exe, и в PowerShell.
- Добавлен точный unit-тест итоговой однострочной команды.

-переменных.

## Куда занесено

- `docs/kb/machines.md`
- `apps/agent/WINDOWS.md`

## Открытые вопросы / что осталось

- Нет.
