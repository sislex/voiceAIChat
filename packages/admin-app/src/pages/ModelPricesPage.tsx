// Тарифы моделей: отдельная страница `#/users/prices`.
//
// По этой таблице считается вторая, независимая от CLI оценка расхода
// (`costFromPrices`): Codex часто не сообщает стоимость сам, и без строки прайса
// его ответы выглядели бы бесплатными.

import { useEffect, useState } from 'react'
import type { ModelPrice, ModelPriceInput } from '@shared/admin'
import { Button } from '@voicechat/ui-kit'
import { formatDate } from '@shared/dateFormat'

const EMPTY_PRICE: ModelPriceInput = { provider: 'codex', model: '', inputPerMillion: 0, cachedInputPerMillion: 0, cacheWritePerMillion: 0, outputPerMillion: 0, sourceUrl: '', effectiveAt: Date.now(), tiers: [] }
const shown = (value: number | null): string => value === null ? '—' : String(value)

export interface ModelPricesPageProps {
  onLoadPriceHistory?: () => Promise<import('@shared/admin').SecurityEvent[]>
  modelPrices?: ModelPrice[]
  onSaveModelPrice?: (input: ModelPriceInput) => void
  onDeleteModelPrice?: (provider: string, model: string) => void
}

export function ModelPricesPage({
  onLoadPriceHistory,
  modelPrices = [],
  onSaveModelPrice = () => undefined,
  onDeleteModelPrice = () => undefined
}: ModelPricesPageProps): JSX.Element {
  const [history, setHistory] = useState<import('@shared/admin').SecurityEvent[]>([])
  const [priceLimit, setPriceLimit] = useState(20)
  const [historyLimit, setHistoryLimit] = useState(100)
  const [historyError, setHistoryError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    if (onLoadPriceHistory) void onLoadPriceHistory().then((events) => { if (!cancelled) { setHistory(events); setHistoryError(null) } }, (error: unknown) => { if (!cancelled) setHistoryError(String(error)) })
    return () => { cancelled = true }
  }, [onLoadPriceHistory, modelPrices])
  const [priceDraft, setPriceDraft] = useState<ModelPriceInput>(EMPTY_PRICE)
  const [editingPrice, setEditingPrice] = useState<string | null>(null)
  const values = [priceDraft, ...(priceDraft.tiers ?? [])].flatMap((price) => [price.inputPerMillion, price.cachedInputPerMillion, price.cacheWritePerMillion, price.outputPerMillion]).filter((value): value is number => value !== null)
  const valid = values.every((value) => Number.isFinite(value) && value >= 0 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-8)

  return (
    <section className="uadmin-sec" data-testid="model-prices-section">
      <p>Официальные тарифы, USD за 1 млн токенов. Базовая категория: Standard / short context.</p>
      <table className="utable"><thead><tr><th>Провайдер / модель</th><th>Режим / контекст</th><th>Input</th><th>Cached input</th><th>Cache writes</th><th>Output</th><th>Источник / дата</th><th>Действия</th></tr></thead><tbody>
        {modelPrices.slice(0, priceLimit).flatMap((price) => {
          const tiers = [{ mode: 'standard', context: 'short', inputPerMillion: price.inputPerMillion, cachedInputPerMillion: price.cachedInputPerMillion, cacheWritePerMillion: price.cacheWritePerMillion, outputPerMillion: price.outputPerMillion }, ...(price.tiers ?? [])]
          return tiers.map((tier, index) => <tr key={price.provider + price.model + tier.mode + tier.context}><td>{index === 0 ? `${price.provider} / ${price.model}` : ''}</td><td>{tier.mode === 'fast' ? 'Fast mode' : tier.mode[0]!.toUpperCase() + tier.mode.slice(1)} / {tier.context} context</td><td>{shown(tier.inputPerMillion)}</td><td>{shown(tier.cachedInputPerMillion)}</td><td>{shown(tier.cacheWritePerMillion)}</td><td>{shown(tier.outputPerMillion)}</td><td>{index === 0 && <><a href={price.sourceUrl} target="_blank" rel="noreferrer">источник</a> · {formatDate(price.effectiveAt)}</>}</td><td>{index === 0 && <><Button size="sm" onClick={() => { setEditingPrice(price.provider + price.model); setPriceDraft({ provider: price.provider, model: price.model, inputPerMillion: price.inputPerMillion, cachedInputPerMillion: price.cachedInputPerMillion, cacheWritePerMillion: price.cacheWritePerMillion, outputPerMillion: price.outputPerMillion, sourceUrl: price.sourceUrl, effectiveAt: price.effectiveAt, tiers: price.tiers ?? [] }) }}>Править</Button><Button variant="danger" size="sm" onClick={() => onDeleteModelPrice(price.provider, price.model)}>Удалить</Button></>}</td></tr>)
        })}
      </tbody></table>
      {modelPrices.length > priceLimit && <Button onClick={() => setPriceLimit(limit => limit + 20)}>Показать ещё модели ({modelPrices.length - priceLimit})</Button>}
      <section aria-label="История цен"><h3>История изменений цены</h3>
        {historyError && <p role="alert">{historyError}</p>}
        {history.length === 0 && <p>Изменений пока нет</p>}
        <ul>{history.slice(0, historyLimit).map((event) => <li key={event.id}>{new Date(event.at).toLocaleString('ru-RU')} · {event.user} · {event.details}</li>)}</ul>
        {history.length > historyLimit && <Button onClick={() => setHistoryLimit(limit => limit + 100)}>Показать ещё события ({history.length - historyLimit})</Button>}
      </section>
      {!valid && <p role="alert">Укажите неотрицательные цены, не более двух знаков после запятой.</p>}
      {values.includes(0) && <p role="status">Цена 0: эти токены будут считаться бесплатными.</p>}
      <div className="ucreate"><p className="ucreate-h">{editingPrice ? 'Править цену' : 'Добавить цену'}</p>
        <input className="login-input" aria-label="Провайдер цены" placeholder="claude" value={priceDraft.provider} onChange={(e) => setPriceDraft({ ...priceDraft, provider: e.target.value })} />
        <input className="login-input" aria-label="Модель цены" placeholder="claude-opus" value={priceDraft.model} onChange={(e) => setPriceDraft({ ...priceDraft, model: e.target.value })} />
        {([['inputPerMillion', 'Вход'], ['cachedInputPerMillion', 'Кэш'], ['cacheWritePerMillion', 'Запись кэша'], ['outputPerMillion', 'Выход']] as const).map(([field, label]) => <input key={field} className="login-input" aria-label={label + ' USD за миллион'} type="number" min="0" step="0.01" value={Number.isFinite(priceDraft[field]) ? priceDraft[field] : ''} onChange={(e) => setPriceDraft({ ...priceDraft, [field]: e.target.value === '' ? NaN : Number(e.target.value) })} />)}
        {(priceDraft.tiers ?? []).map((tier, tierIndex) => <fieldset key={tier.mode + tier.context + tierIndex}>
          <legend>{tier.mode} / {tier.context} context</legend>
          <select aria-label={`Режим категории ${tierIndex + 1}`} value={tier.mode} onChange={(e) => { const tiers = [...(priceDraft.tiers ?? [])]; tiers[tierIndex] = { ...tier, mode: e.target.value as typeof tier.mode }; setPriceDraft({ ...priceDraft, tiers }) }}>{['standard', 'batch', 'flex', 'fast'].map((mode) => <option key={mode} value={mode}>{mode}</option>)}</select>
          <select aria-label={`Контекст категории ${tierIndex + 1}`} value={tier.context} onChange={(e) => { const tiers = [...(priceDraft.tiers ?? [])]; tiers[tierIndex] = { ...tier, context: e.target.value as typeof tier.context }; setPriceDraft({ ...priceDraft, tiers }) }}><option value="short">short</option><option value="long">long</option></select>
          {([['inputPerMillion', 'Input'], ['cachedInputPerMillion', 'Cached input'], ['cacheWritePerMillion', 'Cache writes'], ['outputPerMillion', 'Output']] as const).map(([field, label]) => <input key={field} className="login-input" aria-label={`${tier.mode} ${tier.context} ${label} USD за миллион`} type="number" min="0" step="0.01" value={tier[field] ?? ''} placeholder="—" onChange={(e) => { const tiers = [...(priceDraft.tiers ?? [])]; tiers[tierIndex] = { ...tier, [field]: e.target.value === '' ? null : Number(e.target.value) }; setPriceDraft({ ...priceDraft, tiers }) }} />)}
        </fieldset>)}
        <Button size="sm" onClick={() => setPriceDraft({ ...priceDraft, tiers: [...(priceDraft.tiers ?? []), { mode: 'standard', context: 'long', inputPerMillion: null, cachedInputPerMillion: null, cacheWritePerMillion: null, outputPerMillion: null }] })}>Добавить категорию</Button>
        <input className="login-input" aria-label="Источник цены" placeholder="https://…" value={priceDraft.sourceUrl} onChange={(e) => setPriceDraft({ ...priceDraft, sourceUrl: e.target.value })} />
        <input className="login-input" aria-label="Дата тарифа" type="date" value={new Date(priceDraft.effectiveAt).toISOString().slice(0, 10)} onChange={(e) => { const at = new Date(e.target.value).getTime(); if (Number.isFinite(at)) setPriceDraft({ ...priceDraft, effectiveAt: at }) }} />
        <div className="uadmin-actions"><Button variant="primary" disabled={!valid || !priceDraft.provider.trim() || !priceDraft.model.trim() || !priceDraft.sourceUrl.trim()} onClick={() => { onSaveModelPrice({ ...priceDraft, provider: priceDraft.provider.trim(), model: priceDraft.model.trim(), sourceUrl: priceDraft.sourceUrl.trim() }); setPriceDraft(EMPTY_PRICE); setEditingPrice(null) }}>{editingPrice ? 'Сохранить' : 'Добавить'}</Button>{editingPrice && <Button onClick={() => { setPriceDraft(EMPTY_PRICE); setEditingPrice(null) }}>Отмена</Button>}</div>
      </div>
    </section>
  )
}
