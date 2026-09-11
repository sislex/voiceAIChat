import { mt, setMakeLocale, useMakeLocale } from '../i18n'

/** Interface language is independent of the preview document's language emulation. */
export function MakeLanguageSelect(): JSX.Element {
  const locale = useMakeLocale()
  const label = mt('interfaceLanguage')
  return (
    <label className="make-language" title={label}>
      <span aria-hidden="true">🌐</span>
      <select aria-label={label} value={locale} onChange={(event) => setMakeLocale(event.target.value === 'en' ? 'en' : 'ru')}>
        <option value="ru" lang="ru">Русский</option>
        <option value="en" lang="en">English</option>
      </select>
    </label>
  )
}
