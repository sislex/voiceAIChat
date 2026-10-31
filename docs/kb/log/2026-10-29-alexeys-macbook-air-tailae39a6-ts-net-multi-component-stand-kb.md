---
title: multi-component-stand-kb
date: 2026-10-29
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# multi-component-stand-kb

## Что сделано

- Сверены с merge-кодом маршрутизация Make-операций по компонентам, подготовка локальных worktree, prepared-source overrides launcher-а и доставка по репозиториям.
- Дополнена существующая тема без создания второй статьи о том же механизме.

## Что выяснили (факты, которых не было в KB)

- Верхнеуровневая binding беседы остаётся primary, а `components` описывает все live checkout; files/git с `component` идут в выбранный checkout.
- Локальный launcher принимает три `*_SOURCE`, а внешний Make checkout обслуживает API и видимый frontend.
- Delivery, history и sync выбирают один live repository+branch через необязательный `component`; неоднозначность закрывается ошибкой.

## Куда занесено

- `docs/kb/server-internals.md`, разделы «Make conversation stand worktrees» и «Stand delivery to dev».

## Открытые вопросы / что осталось

- Live acceptance на локальном стенде 25273 остаётся отдельной интеграционной проверкой; в KB не записывалась как выполненная.
