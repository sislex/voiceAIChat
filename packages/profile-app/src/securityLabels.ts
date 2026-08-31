// Подписи событий журнала безопасности.
//
// Жили в UsersAdmin.tsx и были доступны только админке. Человеку про себя нужны
// ровно те же подписи: «login_failed» в его собственном журнале читается не
// лучше, чем в чужом.

export const SECURITY_LABEL: Record<string, string> = {
  agent_connected: 'Агент подключился',
  agent_rejected: 'Агент отклонён',
  agent_token_rotated: 'Токен агента перевыпущен',
  agent_token_revoked: 'Токен агента отозван',
  signup_requested: 'Заявка на регистрацию',
  signup_verified: 'Email подтверждён',
  login_new_device: 'Вход с нового устройства',
  inactive_blocked: 'Отключён за неактивность',
  reset_code_issued: 'Выдан код сброса',
  password_reset: 'Пароль сброшен по коду',
  password_changed: 'Пароль изменён',
  invite_created: 'Создан инвайт',
  project_invited: 'Приглашение в проект',
  project_invite_accepted: 'Приглашение принято',
  registered: 'Регистрация по инвайту',
  login: 'Вход',
  login_failed: 'Неверный пароль',
  login_locked: 'Замок после неудач',
  login_2fa_failed: 'Неверный код 2FA',
  logout: 'Выход',
  logout_all: 'Выход везде',
  session_revoked: 'Сессия отозвана',
  session_renamed: 'Устройство переименовано',
  session_trusted: 'Устройство доверено',
  session_untrusted: 'Доверие снято',
  session_evicted: 'Сессия вытеснена лимитом',
  session_panic: 'Тревога: «это не я»',
  password_set: 'Пароль установлен',
  twofactor_enabled: '2FA включена',
  twofactor_disabled: '2FA выключена',
  user_blocked: 'Заблокирован',
  user_unblocked: 'Разблокирован'
}

/**
 * Группы событий и признак тревожности живут в контракте (`@voicechat/shared`):
 * по ним фильтрует и сервер, а две копии одного разбиения разошлись бы при
 * первом же новом типе события. Здесь — только подписи для человека.
 */
export type SecurityGroup = 'all' | 'auth' | 'account' | 'machines'

/** Подпись типа события; незнакомый тип показываем как есть, а не прячем. */
export function securityLabel(type: string): string {
  return SECURITY_LABEL[type] ?? type
}

/** Событие тревожное: неудачные входы, замки, блокировки, отказы агентам. */
export function isAlarming(type: string): boolean {
  return /failed|locked|blocked|rejected|panic/.test(type)
}

