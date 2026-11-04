---
title: sisl-810-knowledge-gaps
date: 2026-10-31
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# sisl-810-knowledge-gaps

## Что сделано

Сверены изменения SISL-810 в координаторе, memory/SQL metadata adapters,
Shared-контракте и HTTP-регрессиях. Устранены старые противоречащие описания
очистки дублей и уточнена граница owner-документации Make.

## Что выяснили (факты, которых не было в KB)

Применение preview выполняется телом только с `previewToken`; одинаковые пути
не блокируют merge, а сохраняют старые версии в `.duplicates`. Каноническая
identity идёт первой в списках обоих metadata adapters. `make:README.md` —
межмодульный KB-идентификатор, а не локальный файл Core checkout.

## Куда занесено

Обновлены `server-internals.md`, `data-auth.md`, `architecture.md`,
`shared.md`, `protocol.md` и `modules.md`; индекс перегенерирован.

## Открытые вопросы / что осталось

Make owner source отсутствует в этой рабочей копии, поэтому его внутренние
`findProject`, import и UI-регрессии здесь не выдаются за проверенные Core-факты.
Живая очистка M2 также остаётся отдельной авторизованной проверкой доставки.
