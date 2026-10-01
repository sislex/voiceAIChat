---
title: release-retention
date: 2026-10-01
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Уборка старых образов приложений после выката

## Изменение

- Уборка выпусков в `voicechat-deploy` (`scripts/prod/deploy.sh`, `cleanup_old_releases`) уже
  оставляла 3 последних каталога в `/opt/voicechat/releases` и удаляла их локальные образы Core.
  Образы приложений (`ghcr.io/sislex/*`, локальный `sislexa-kanban`) копились с каждым выпуском.
- `scripts/prod/release_retention.py --in-use` теперь планирует и их: тег удаляется, только если
  его не называет ни один оставшийся чекаут, файл цепочки `COMPOSE_FILE`, строка
  `SISLEXA_*_IMAGE` в `.env` и ни один контейнер, даже остановленный. Прочие строки `.env` не
  читаются. Если старый каталог пришлось оставить, образы приложений в этот раз не трогаются.
- `VC_RETENTION_DRY_RUN=1` — только записать план в лог выката.

## Тема базы знаний

- `docs/kb/deploy.md` — уборка выпусков после health-check.

## Осталось

- Первый выкат на проде стоит провести с `VC_RETENTION_DRY_RUN=1` и посмотреть план в
  `/var/log/voicechat-deploy.log`.
