// Внутренний протокол «админка ↔ ядро» для отдельного процесса админки (docs/plans/machines-service.md,
// круг 3). Админке от ядра нужны две вещи, которых нет в базе: запуск деплоя (сокет host-side API живёт
// на хосте ядра) и живое уведомление владельца об отзыве сессии (сокеты пользователей — у ядра).
export const INTERNAL_ADMIN_RPC_PATH = '/internal/admin/rpc'
export const ADMIN_HEALTH_PATH = '/v1/health'
export const ADMIN_RPC_METHODS = ['deploy', 'sessionsChanged'] as const
export type AdminRpcMethod = (typeof ADMIN_RPC_METHODS)[number]
