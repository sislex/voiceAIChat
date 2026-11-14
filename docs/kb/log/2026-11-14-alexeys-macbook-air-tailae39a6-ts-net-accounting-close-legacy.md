---
title: accounting-close-legacy
date: 2026-11-14
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# accounting-close-legacy

## Что сделано

- На проде 1722 записи учёта висели в `dispatching`: до исправления квитанции мастер-токена раннера не принимались, расход не закрывался.
- Решение владельца: старые записи закрыть без списания, считать расход с момента выката.
- Журнал учёта запоминает момент первого запуска с новым правилом (`chat_accounting_meta.settleSince`). Записи, отправленные раньше, сверка закрывает нулевым расчётом `unsettled-before-accounting:<id>` и к раннеру за квитанцией не ходит.
- Тест в `billing/chatAccounting.test.ts`, тема `llm.md`.
