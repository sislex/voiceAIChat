// Формат дат живёт в `@voicechat/shared`: им пользуется и админка, которая
// импортировать `@voicechat/ui` не может — тот сам зависит от неё. Здесь
// остался тонкий реэкспорт, чтобы не править десяток импортов в пакете.
export { formatDate, formatDateTime, formatRelativeTime, isoDate } from '@shared/dateFormat'
