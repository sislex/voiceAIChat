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
