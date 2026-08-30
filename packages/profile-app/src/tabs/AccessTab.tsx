// Доступ к моделям: карточка на провайдера, тумблер на провайдера, чекбокс на модель.
//
// Пустой список запретов означает полный доступ — так устроен контракт
// (deny-list), и это единственное состояние, где «ничего не настроено» и
// «разрешено всё» совпадают.

import { useState } from 'react'
import { Button, SearchField, Switch } from '@voicechat/ui-kit'
import type { ProfileAccessDenial, ProfileCapabilities, ProfileProvider } from '../contracts'
import { accessSummary, isModelDenied, isProviderEnabled, setAllAccess, toggleAccess } from '../model'

export interface AccessTabProps {
  providers: readonly ProfileProvider[]
  denied: readonly ProfileAccessDenial[]
  capabilities: ProfileCapabilities
  onChange: (denied: ProfileAccessDenial[]) => void
}

export function AccessTab({ providers, denied, capabilities, onChange }: AccessTabProps): JSX.Element {
  const [query, setQuery] = useState('')
  const summary = accessSummary(denied, providers)
  const editable = capabilities.canEditAccess
  const match = (text: string): boolean => text.toLowerCase().includes(query.trim().toLowerCase())

  return (
    <section className="vcp-access" data-testid="access-tab">
      <div className="vcp-section-head">
        <div>
          <h3>Доступ к моделям</h3>
          <p>{editable ? 'Пустые права означают полный доступ.' : 'Права выдаёт администратор — здесь они только видны.'}</p>
        </div>
        <SearchField compact value={query} onChange={setQuery} label="Найти модель" testId="model-search" />
      </div>

      <div className="vcp-access__toolbar">
        <span><b>{summary.allowed}</b> разрешено · <b>{summary.denied}</b> запрещено</span>
        {editable && (
          <span className="vcp-access__bulk">
            <Button size="sm" variant="ghost" onClick={() => onChange(setAllAccess(providers, true))}>Разрешить всё</Button>
            <Button size="sm" variant="ghost" onClick={() => onChange(setAllAccess(providers, false))}>Запретить всё</Button>
          </span>
        )}
      </div>

      {providers.map((provider) => {
        const enabled = isProviderEnabled(denied, provider.id)
        const stat = summary.byProvider.find((item) => item.provider === provider.id)
        const models = provider.models.filter((model) => match(model.label) || match(model.id))
        return (
          <article key={provider.id} className="vcp-provider" data-testid={`provider-${provider.id}`}>
            <div className="vcp-provider__head">
              <div>
                <h3>{provider.label}</h3>
                <p>{stat ? `${stat.allowed} из ${stat.total} моделей доступны` : ''}</p>
              </div>
              <Switch
                checked={enabled}
                disabled={!editable}
                label={`Доступ к ${provider.label}`}
                onChange={(next) => onChange(toggleAccess(denied, provider.id, '*', next))}
              />
            </div>
            {models.length > 0 && (
              <div className="vcp-provider__models">
                {models.map((model) => (
                  <label key={model.id}>
                    <input
                      type="checkbox"
                      checked={!isModelDenied(denied, provider.id, model.id)}
                      disabled={!editable}
                      onChange={(event) => onChange(toggleAccess(denied, provider.id, model.id, event.target.checked, provider.models.map((item) => item.id)))}
                    />
                    <span>
                      <b>{model.label}</b>
                      {model.note && <small>{model.note}</small>}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </article>
        )
      })}
    </section>
  )
}
