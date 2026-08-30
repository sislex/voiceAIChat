import { plural } from './format'

// Тексты вынесены отдельно, чтобы чужое приложение переопределяло их точечно,
// не форкая компоненты. Значения по умолчанию — русские: модуль приехал из
// русскоязычного продукта, и «переводить обратно» никому не нужно.
export interface SessionsTexts {
  title: string
  lead: string
  loading: string
  emptyTitle: string
  emptyDescription: string
  errorMessage: string
  retry: string
  searchLabel: string
  searchPlaceholder: string
  searchEmpty: string
  currentBadge: string
  trustedBadge: string
  onlineBadge: string
  unknownPlace: string
  legacyTitle: string
  revoke: string
  revokeConfirmTitle: (device: string) => string
  revokeConfirmText: string
  revokeOthers: (count: number) => string
  revokeOthersDone: string
  revokeAll: string
  revokeAllConfirmTitle: string
  revokeAllConfirmText: string
  rename: string
  renameLabel: string
  renameSave: string
  renameCancel: string
  trust: string
  untrust: string
  signedOut: string
  panic: string
  panicConfirmTitle: string
  panicConfirmText: string
  endedTitle: string
  endedEmpty: string
  endedAt: (when: string) => string
  platformAll: string
  platformLabel: (platform: string) => string
  siblings: (count: number) => string
  activity: (requests: number, path: string) => string
  twoFactorBadge: string
  revokeDevice: (count: number) => string
  revokeDeviceOthers: (count: number) => string
  revokeDeviceConfirmTitle: (device: string) => string
  revokeDeviceConfirmText: string
  historyToggle: string
  historyEmpty: string
  historyEvent: (type: string) => string
  moreHidden: (count: number) => string
  createdAt: (when: string) => string
  lastSeen: (when: string) => string
  expiresIn: (when: string) => string
  expired: string
}

/** Подписи событий журнала: в карточке нужен человеческий язык, а не коды. */
const HISTORY_LABELS: Record<string, string> = {
  login: 'вход',
  login_new_device: 'вход с нового устройства',
  login_failed: 'неверный пароль',
  login_locked: 'замок после неудач',
  login_2fa_failed: 'неверный код',
  logout: 'выход',
  logout_all: 'выход везде',
  session_revoked: 'сессия завершена',
  session_renamed: 'устройство переименовано',
  session_trusted: 'устройство доверено',
  session_untrusted: 'доверие снято',
  session_evicted: 'вытеснена лимитом',
  session_panic: 'тревога «это не я»',
  password_changed: 'пароль изменён',
  password_reset: 'пароль сброшен'
}

export const DEFAULT_TEXTS: SessionsTexts = {
  title: 'Сессии и устройства',
  lead: 'Где вы вошли в приложение. Завершённая сессия сразу теряет доступ.',
  loading: 'Загрузка…',
  emptyTitle: 'Активных сессий нет',
  emptyDescription: 'Как только вы войдёте с любого устройства, оно появится здесь.',
  errorMessage: 'Не удалось получить список сессий',
  retry: 'Повторить',
  searchLabel: 'Поиск по устройствам',
  searchPlaceholder: 'Браузер, система, адрес…',
  searchEmpty: 'Ничего не найдено',
  currentBadge: 'это устройство',
  trustedBadge: 'доверенное',
  onlineBadge: 'активна сейчас',
  unknownPlace: 'адрес неизвестен',
  legacyTitle: 'Устройство без метки',
  revoke: 'Завершить',
  revokeConfirmTitle: (device) => `Завершить сессию «${device}»?`,
  revokeConfirmText: 'Устройство сразу потеряет доступ, войти снова можно будет с паролем.',
  revokeOthers: (count) => `Выйти на других устройствах (${count})`,
  revokeOthersDone: 'Другие сессии завершены',
  revokeAll: 'Выйти везде, включая это устройство',
  revokeAllConfirmTitle: 'Выйти на всех устройствах?',
  revokeAllConfirmText: 'Текущая сессия тоже завершится — потребуется войти заново.',
  rename: 'Переименовать',
  renameLabel: 'Название устройства',
  renameSave: 'Сохранить',
  renameCancel: 'Отмена',
  trust: 'Сделать доверенным',
  untrust: 'Снять доверие',
  signedOut: 'Вашу сессию завершили на другом устройстве',
  panic: 'Это не я — закрыть все входы',
  panicConfirmTitle: 'Закрыть все входы и сменить пароль?',
  panicConfirmText: 'Все сессии, включая эту, завершатся, а при следующем входе приложение потребует новый пароль. Так делают, когда вход совершил кто-то чужой.',
  endedTitle: 'Недавно завершённые',
  endedEmpty: 'Завершённых сессий пока нет',
  endedAt: (when) => `завершена ${when}`,
  platformAll: 'Все',
  platformLabel: (platform) => (platform === 'web' ? 'Браузер' : platform === 'desktop' ? 'Приложение' : platform === 'agent' ? 'Агент' : platform),
  siblings: (count) => `ещё ${count} ${count === 1 ? 'сессия' : count < 5 ? 'сессии' : 'сессий'} этого устройства`,
  twoFactorBadge: 'подтверждено кодом',
  // Коротко: длинная подпись в ряду действий выдавливает саму карточку.
  revokeDevice: (count) => `Завершить устройство (${count})`,
  // У текущей карточки та же кнопка гасит только соседние входы — об этом и говорим,
  // иначе человек решит, что выбьет сам себя.
  revokeDeviceOthers: (count) => `Завершить другие входы (${count})`,
  revokeDeviceConfirmTitle: (device) => `Завершить все входы с «${device}»?`,
  revokeDeviceConfirmText: 'Устройство потеряет доступ во всех вкладках и приложениях сразу.',
  historyToggle: 'Что делало это устройство',
  historyEmpty: 'Событий по этому устройству нет',
  historyEvent: (type) => HISTORY_LABELS[type] ?? type,
  moreHidden: (count) => `Показаны первые записи, ещё ${count} скрыто — уточните поиск`,
  activity: (requests, path) => {
    const hits = `${requests} ${plural(requests, 'обращение', 'обращения', 'обращений')}`
    return path ? `${hits} · ${path}` : hits
  },
  createdAt: (when) => `вход ${when}`,
  lastSeen: (when) => `активность ${when}`,
  expiresIn: (when) => `истекает через ${when}`,
  expired: 'срок истёк'
}
