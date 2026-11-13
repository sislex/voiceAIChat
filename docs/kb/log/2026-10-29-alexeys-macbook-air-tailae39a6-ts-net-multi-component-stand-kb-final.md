---
title: multi-component-stand-kb-final
date: 2026-10-29
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# multi-component-stand-kb-final

## Что сделано

- Сверены на merge SHA локальное расширение Make RPC, маршрутизация files/git по компонентам, prepared-source launcher и выбор репозитория доставки.
- Уточнены существующие разделы без создания дублирующей темы.

## Что выяснили (факты, которых не было в KB)

- Верхнеуровневые поля результата сохраняют primary binding даже после операции во вторичном checkout; отсутствующий live checkout выбранного компонента отклоняется.
- Явный component одинаково выбирает live repository+branch для доставки, истории и sync; без него неоднозначность закрывается ошибкой.
- Для каждого выбранного репозитория координатор получает отдельную доставку.

## Куда занесено

- `docs/kb/server-internals.md`, разделы «Make conversation stand worktrees» и «Stand delivery to dev».

## Открытые вопросы / что осталось

- Live acceptance на стенде 25273 в этом KB-ходе не выполнялась и не отмечена как подтверждённая.
