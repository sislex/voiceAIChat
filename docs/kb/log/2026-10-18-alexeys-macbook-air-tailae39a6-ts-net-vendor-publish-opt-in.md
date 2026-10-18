---
title: vendor-publish-opt-in
date: 2026-10-18
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# vendor-publish-opt-in

## Что сделано

- Публикация в релиз `vendor` только по явному согласию (`--publish`, `npm run vendor:publish`); у
  `publishVendorArchives` нет сетевого значения по умолчанию, публикатор передаётся зависимостью.
- `ghVendorPublisher` отказывается работать под тест-раннером; тесты используют фейки и проверяют, что `gh` не вызывается.

## Что выяснили (факты, которых не было в KB)

- Первый прогон `contracts-release.test.mjs` с версией PR #728 загрузил фикстуры (`old.tgz`,
  `voicechat-make-contracts-2.0.0-*.tgz`, три `voicechat-shared-0.2.0-*.tgz`) в настоящий релиз; координатор их удалил.

## Куда занесено

- docs/kb/deploy.md, vendor/README.md.

## Открытые вопросы / что осталось

-
