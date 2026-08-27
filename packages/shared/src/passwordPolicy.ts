// Политика пароля (auth-roadmap п.2): единые правила для сервера (400 на создании/смене) и форм (подсказка до отправки).
// Пустой пароль запрещён, минимум 10 символов, не совпадает с логином, не из списка самых частых, не один повторяющийся символ.

export const PASSWORD_MIN_LENGTH = 10

const COMMON = new Set(['password', 'password1', 'qwertyuiop', 'qwerty1234', '1234567890', '12345678910', 'iloveyou12', 'admin12345', 'letmein123', 'welcome123', 'passw0rd12', 'p@ssw0rd12', 'abc1234567', 'password123', 'qwerty12345', '1q2w3e4r5t', 'zxcvbnm123', 'администратор', 'парольпароль'])

/** Текст нарушения по-русски или null, если пароль допустим. */
export function checkPasswordPolicy(password: string, context: { name?: string } = {}): string | null {
  if (!password) return 'Пароль не может быть пустым'
  if (password.length < PASSWORD_MIN_LENGTH) return `Пароль короче ${PASSWORD_MIN_LENGTH} символов`
  if (/^(.)\1+$/.test(password)) return 'Пароль из одного повторяющегося символа'
  const lower = password.toLowerCase()
  if (COMMON.has(lower)) return 'Слишком распространённый пароль'
  const name = context.name?.trim().toLowerCase()
  if (name && name.length >= 3 && lower.includes(name)) return 'Пароль не должен содержать логин'
  return null
}
