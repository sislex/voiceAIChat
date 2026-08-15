import { useEffect, useMemo, useState } from 'react'
import type { SessionUser, UserPersonalization } from '@shared/types'
import { DEFAULT_PERSONALIZATION } from '@shared/types'
import { Button } from '@voicechat/ui-kit'
import { useConfirm } from '@voicechat/ui-kit'

export interface SettingsPageTab<T extends string> {
  id: T
  label: string
}

/** Общий каркас навигации страниц настроек проекта и чата; состав табов задаёт вызывающая страница. */
export function SettingsPage<T extends string>({ tabs, activeTab, onTabChange, ariaLabel }: {
  tabs: Array<SettingsPageTab<T>>
  activeTab: T
  onTabChange: (tab: T) => void
  ariaLabel: string
}): JSX.Element {
  return <div className="proj-settings-tabs" role="tablist" aria-label={ariaLabel} data-testid="settings-page">
    {tabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} className={activeTab === tab.id ? 'active' : ''} onClick={() => onTabChange(tab.id)}>{tab.label}</button>)}
  </div>
}

const LANGUAGES = [['ru','Русский'],['en','English'],['de','Deutsch'],['fr','Français'],['es','Español'],['it','Italiano'],['pt','Português'],['uk','Українська'],['pl','Polski'],['tr','Türkçe'],['zh','中文'],['ja','日本語'],['ko','한국어'],['ar','العربية'],['hi','हिन्दी']] as const
const MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря']

export function isValidPersonalizationDate({ birthDay: day, birthMonth: month, birthYear: year }: UserPersonalization): boolean {
  if (day !== null && (day < 1 || day > 31)) return false
  if (month !== null && (month < 1 || month > 12)) return false
  if (year !== null && (year < 1900 || year > new Date().getFullYear())) return false
  return day === null || month === null || day <= new Date(Date.UTC(year ?? 2000, month, 0)).getUTCDate()
}

export function PersonalizationPage({ user, value, onSave, onCancel }: { user: SessionUser; value: UserPersonalization; onSave: (value: UserPersonalization) => Promise<void>; onCancel: () => void }): JSX.Element {
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const confirm = useConfirm()
  useEffect(() => setDraft(value), [value])
  const dirty = JSON.stringify(draft) !== JSON.stringify(value)
  const valid = isValidPersonalizationDate(draft)
  const titleName = draft.preferredName || user.name
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent): void => { if (dirty) event.preventDefault() }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])
  const leave = async (): Promise<void> => {
    if (dirty && !(await confirm({ title: 'Отменить изменения?', message: 'Несохранённые настройки будут потеряны.', confirmLabel: 'Отменить изменения' }))) return
    onCancel()
  }
  const years = useMemo(() => Array.from({ length: new Date().getFullYear() - 1899 }, (_, i) => new Date().getFullYear() - i), [])
  const number = (raw: string): number | null => raw ? Number(raw) : null
  return <main className="personalization-page">
    <header><h1>Персонализация — {titleName}</h1><p>Настройте обычный язык, объём и тон ответов. Явная просьба в сообщении всегда важнее этих предпочтений.</p></header>
    <section><h2>Как обращаться</h2><label>Имя или обращение<input maxLength={80} value={draft.preferredName ?? ''} onChange={(e) => setDraft({ ...draft, preferredName: e.target.value.replace(/\s+/g, ' ').trimStart() || null })} /></label><label className="personal-check"><input type="checkbox" checked={draft.preferredName === null} onChange={(e) => setDraft({ ...draft, preferredName: e.target.checked ? null : user.name })} /> Без обращения</label></section>
    <section><h2>Дата рождения</h2><p className="field-hint">Используется только для адаптации формулировок и сложности ответа; модели передаётся вычисленный возраст, а не дата.</p><div className="personal-date">
      <label>День<select value={draft.birthDay ?? ''} onChange={(e) => setDraft({ ...draft, birthDay: number(e.target.value) })}><option value="">Не указано</option>{Array.from({length:31},(_,i)=><option key={i+1}>{i+1}</option>)}</select></label>
      <label>Месяц<select value={draft.birthMonth ?? ''} onChange={(e) => setDraft({ ...draft, birthMonth: number(e.target.value) })}><option value="">Не указано</option>{MONTHS.map((m,i)=><option key={m} value={i+1}>{i+1} — {m}</option>)}</select></label>
      <label>Год<select value={draft.birthYear ?? ''} onChange={(e) => setDraft({ ...draft, birthYear: number(e.target.value) })}><option value="">Не указано</option>{years.map(y=><option key={y}>{y}</option>)}</select></label>
    </div>{!valid && <p role="alert" className="field-error">Такой даты не существует.</p>}</section>
    <section><h2>Язык ответа ИИ</h2><label>Язык<select value={draft.responseLanguage ?? ''} onChange={(e) => setDraft({ ...draft, responseLanguage: e.target.value || null })}><option value="">Определять по языку сообщения</option>{LANGUAGES.map(([code,label])=><option key={code} value={code}>{label}</option>)}</select></label></section>
    <section><h2>Стиль ответа</h2><label>Объём<select value={draft.responseStyle} onChange={(e) => setDraft({ ...draft, responseStyle: e.target.value as UserPersonalization['responseStyle'] })}><option value="brief">Кратко</option><option value="normal">Обычно</option><option value="detailed">Подробно</option><option value="step-by-step">Пошагово</option></select></label></section>
    <section><h2>Тон общения</h2><label>Тон<select value={draft.tone} onChange={(e) => setDraft({ ...draft, tone: e.target.value as UserPersonalization['tone'] })}><option value="neutral">Нейтральный</option><option value="friendly">Дружелюбный</option><option value="business">Деловой</option><option value="plain">Простой, без сложных терминов</option></select></label></section>
    <div className="personal-actions"><Button variant="primary" loading={saving} disabled={!dirty || !valid} onClick={() => { setSaving(true); void onSave({ ...draft, preferredName: draft.preferredName?.trim().replace(/\s+/g, ' ') || null }).finally(() => setSaving(false)) }}>Сохранить</Button><Button variant="secondary" onClick={() => void leave()}>Отменить изменения</Button><Button variant="ghost" onClick={() => setDraft(DEFAULT_PERSONALIZATION)}>Вернуть настройки по умолчанию</Button></div>
  </main>
}
