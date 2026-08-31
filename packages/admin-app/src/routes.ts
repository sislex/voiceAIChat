// Маршрут админки переехал в `@shared/adminRoute`: его читает хост при каждом
// рендере, и статический импорт из этого пакета возвращал всю админку в главный
// чанк. Здесь остался ре-экспорт, чтобы публичный API пакета не менялся.
export { parseAdminRoute, buildAdminRoute, createAdminNavigationModel } from '@shared/adminRoute'
export type { AdminRoute, AdminTab, AdminUsersQuery } from '@shared/adminRoute'
