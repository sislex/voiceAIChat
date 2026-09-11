import { formatMakeMessage, type MakeLocale } from '@voicechat/make-contracts/localization'

const messages = {
  tests: { ru: 'Тесты', en: 'Tests' },
  assertion: { ru: 'Ожидалось: {p0} {p1} {p2}', en: 'Expected: {p0} {p1} {p2}' },
  textAssertion: { ru: 'Ожидалось, что текст {p0} содержит {p1}', en: 'Expected text {p0} to contain {p1}' },
  classAssertion: { ru: 'Ожидался элемент с классом {p0}', en: 'Expected an element with class {p0}' },
  language: { ru: 'Язык интерфейса', en: 'Interface language' },
  comment: { ru: '💬 Комментарий', en: '💬 Comment' },
  commentTitle: { ru: 'Комментарий автору', en: 'Comment for the author' },
  name: { ru: 'Ваше имя (необязательно)', en: 'Your name (optional)' },
  feedback: { ru: 'Что поправить или что понравилось?', en: 'What should change, or what did you like?' },
  cancel: { ru: 'Отмена', en: 'Cancel' },
  send: { ru: 'Отправить', en: 'Send' },
  sending: { ru: 'Отправляю…', en: 'Sending…' },
  page: { ru: 'страница', en: 'page' },
  tooManyComments: { ru: 'Слишком много сообщений, попробуйте позже', en: 'Too many messages. Try again later.' },
  sendFailed: { ru: 'Не удалось отправить', en: 'Could not send the comment' },
  thanks: { ru: 'Спасибо! Комментарий появится после проверки автором.', en: 'Thank you! Your comment will appear after the author reviews it.' },
  passwordAccess: { ru: 'Доступ по паролю', en: 'Password access' },
  passwordProtected: { ru: 'Проект защищён паролем', en: 'This project is password-protected' },
  tooManyAttempts: { ru: 'Слишком много попыток — подождите {p0} с.', en: 'Too many attempts. Wait {p0} s.' },
  wrongPassword: { ru: 'Пароль не подошёл — попробуйте ещё раз.', en: 'Incorrect password. Try again.' },
  projectPassword: { ru: 'Пароль проекта', en: 'Project password' },
  password: { ru: 'Пароль', en: 'Password' },
  open: { ru: 'Открыть', en: 'Open' },
  components: { ru: 'Компоненты', en: 'Components' },
  code: { ru: 'Код', en: 'Code' },
  copy: { ru: 'Скопировать', en: 'Copy' },
  copied: { ru: 'Скопировано', en: 'Copied' },
  copyManually: { ru: 'Выделите и скопируйте', en: 'Select and copy' },
  searchPlaceholder: { ru: 'Поиск компонента или стори…', en: 'Search components or stories…' },
  searchLabel: { ru: 'Поиск по витрине', en: 'Search showcase' },
  noStories: { ru: 'В проекте пока нет сториз (*.stories.jsx/tsx).', en: 'The project has no stories yet (*.stories.jsx/tsx).' },
  of: { ru: ' из ', en: ' of ' },
  noStoryExports: { ru: 'В файле нет именованных экспортов-стори', en: 'The file has no named story exports' },
  noRender: { ru: 'У стори «{p0}» нет component или render', en: 'Story “{p0}” has no component or render' },
  clickMissing: { ru: 'click: элемент не найден', en: 'click: element not found' },
  typeMissing: { ru: 'type: элемент не найден', en: 'type: element not found' },
  noTests: { ru: 'В файле нет вызовов test(name, fn)', en: 'The file has no test(name, fn) calls' }
} as const

export function publicText(locale: MakeLocale, key: keyof typeof messages, values?: Record<string, unknown>): string {
  return formatMakeMessage(messages[key][locale], values)
}

/** Only Make-owned pages use this control; project documents retain their own language. */
export function publicLanguageSelect(locale: MakeLocale): string {
  return `<label style="font:inherit">${publicText(locale, 'language')} <select aria-label="${publicText(locale, 'language')}" onchange="var u=new window.URL(window.location.href);u.searchParams.set('makeLocale',this.value);document.cookie='vc_make_locale='+this.value+'; Path=/; SameSite=Lax; Max-Age=31536000';window.location.href=u.href"><option value="ru" lang="ru"${locale === 'ru' ? ' selected' : ''}>Русский</option><option value="en" lang="en"${locale === 'en' ? ' selected' : ''}>English</option></select></label>`
}
