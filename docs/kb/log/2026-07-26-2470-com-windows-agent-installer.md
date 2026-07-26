---
title: windows-agent-installer
date: 2026-07-26
machine: 2470-com
author: server
---

# windows-agent-installer

## Что сделано

- Установка машины-агента на Windows одной командой (аналог Termux):
  `GET /api/agents/install-windows.ps1` (`agents/windowsInstall.ts`, публичный) —
  PowerShell-скрипт: Node 22+ (иначе последняя портативная в
  `%LOCALAPPDATA%\voicechat-agent\node`), скачивание `.cjs`, сохранение строки
  подключения, автозапуск (HKCU `Run` → wscript → скрытый `run.cmd`), запуск.
- Агент теперь работает на Windows: `resolveShell()` → `cmd.exe` (ComSpec) для
  exec, `pickShell()` → `powershell.exe` для консоли, `which()` подставляет
  `.exe/.cmd/.bat`, pipe-fallback без `-i`. `AGENT_VERSION` → 0.6.0.
- UI: кнопка «🪟 Команда для Windows (PowerShell)» после создания машины
  и подсказка в разделе «Скачать». Новый `apps/agent/WINDOWS.md`.

## Что выяснили (факты, которых не было в KB)

- PowerShell 5.1 читает `.ps1` без BOM в ANSI — русские строки ломаются;
  установщик отдаётся с BOM (`﻿` в начале).
- `userEvent.setup()` из @testing-library/user-event подменяет
  `navigator.clipboard` своим стабом — тесты копирования в буфер пишем через
  `fireEvent`, иначе свой мок clipboard не вызывается.
- Node `spawn(cmd, {shell})` на Windows корректно квотит только под `cmd.exe`,
  поэтому exec идёт через ComSpec, а PowerShell — только для интерактивной консоли.

## Куда занесено

- docs/kb/machines.md («Windows — грабли», способы установки)
- docs/kb/protocol.md (публичный `agentInstallWindows`)
- apps/agent/AGENTS.md, apps/agent/WINDOWS.md

## Открытые вопросы / что осталось

- Установщик не гасит уже запущенный экземпляр агента при переустановке
  (как и Termux-вариант) — при повторной установке возможен второй процесс
  до перезагрузки/ручной остановки.
