---
title: enrollment-selector
date: 2026-09-02
machine: macbook-air-user
author: NikolayTola
---

# enrollment-selector

## Что сделано

Описан новый основной flow подключения текущего устройства через двухминутный enrollment и VoiceChat Login, включая однократное продолжение сохранённого действия после появления машины online.

## Что выяснили (факты, которых не было в KB)

Существующая Electron-конфигурация заменяется только после системного подтверждения и записывается через временный файл с атомарным rename. Enrollment deep link принимает любой HTTPS origin, а HTTP — только localhost, IPv6 loopback и 127.0.0.0/8. Web polling защищён generation-счётчиком от запоздалых ответов после закрытия или перезапуска flow.

## Куда занесено

`docs/kb/clients.md` и `docs/kb/machines.md`.

## Открытые вопросы / что осталось

Нет.
