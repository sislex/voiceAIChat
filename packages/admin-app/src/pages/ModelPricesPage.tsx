// Тарифы моделей: отдельная страница `#/users/prices`.
//
// По этой таблице считается вторая, независимая от CLI оценка расхода
// (`costFromPrices`): Codex часто не сообщает стоимость сам, и без строки прайса
// его ответы выглядели бы бесплатными.

import { useState } from 'react'
import type { ModelPrice, ModelPriceInput } from '@shared/admin'
import { Button } from '@voicechat/ui-kit'
import { formatDate } from '@shared/dateFormat'

const EMPTY_PRICE: ModelPriceInput = { provider: 'codex', model: '', inputPerMillion: 0, cachedInputPerMillion: 0, cacheWritePerMillion: 0, outputPerMillion: 0, sourceUrl: '', effectiveAt: Date.now() }

export interface ModelPricesPageProps {
  modelPrices?: ModelPrice[]
  onSaveModelPrice?: (input: ModelPriceInput) => void
  onDeleteModelPrice?: (provider: string, model: string) => void
}

export function ModelPricesPage({
  modelPrices = [],
  onSaveModelPrice = () => undefined,
  onDeleteModelPrice = () => undefined
}: ModelPricesPageProps): JSX.Element {
  const [priceDraft, setPriceDraft] = useState<ModelPriceInput>(EMPTY_PRICE)
  const [editingPrice, setEditingPrice] = useState<string | null>(null)

  return (
    <section className="uadmin-sec" data-testid="model-prices-section">
            <table className="utable"><thead><tr><th>Провайдер / модель</th><th>Вход</th><th>Кэш</th><th>Запись кэша</th><th>Выход</th><th>Источник / дата</th><th>Действия</th></tr></thead><tbody>
        {modelPrices.map((price) => <tr key={price.provider + price.model}><td>{price.provider} / {price.model}</td><td>{price.inputPerMillion}</td><td>{price.cachedInputPerMillion}</td><td>{price.cacheWritePerMillion}</td><td>{price.outputPerMillion}</td><td><a href={price.sourceUrl} target="_blank" rel="noreferrer">источник</a> · {formatDate(price.effectiveAt)}</td><td><Button size="sm" onClick={() => { setEditingPrice(price.provider + price.model); setPriceDraft({ provider: price.provider, model: price.model, inputPerMillion: price.inputPerMillion, cachedInputPerMillion: price.cachedInputPerMillion, cacheWritePerMillion: price.cacheWritePerMillion, outputPerMillion: price.outputPerMillion, sourceUrl: price.sourceUrl, effectiveAt: price.effectiveAt }) }}>Править</Button><Button variant="danger" size="sm" onClick={() => onDeleteModelPrice(price.provider, price.model)}>Удалить</Button></td></tr>)}
      </tbody></table>
      <div className="ucreate"><p className="ucreate-h">{editingPrice ? 'Править цену' : 'Добавить цену'}</p>
        <input className="login-input" aria-label="Провайдер цены" placeholder="claude" value={priceDraft.provider} onChange={(e) => setPriceDraft({ ...priceDraft, provider: e.target.value })} />
        <input className="login-input" aria-label="Модель цены" placeholder="claude-opus" value={priceDraft.model} onChange={(e) => setPriceDraft({ ...priceDraft, model: e.target.value })} />
        {([['inputPerMillion', 'Вход'], ['cachedInputPerMillion', 'Кэш'], ['cacheWritePerMillion', 'Запись кэша'], ['outputPerMillion', 'Выход']] as const).map(([field, label]) => <input key={field} className="login-input" aria-label={label + ' USD за миллион'} type="number" min="0" value={priceDraft[field]} onChange={(e) => setPriceDraft({ ...priceDraft, [field]: Number(e.target.value) })} />)}
        <input className="login-input" aria-label="Источник цены" placeholder="https://…" value={priceDraft.sourceUrl} onChange={(e) => setPriceDraft({ ...priceDraft, sourceUrl: e.target.value })} />
        <input className="login-input" aria-label="Дата тарифа" type="date" value={new Date(priceDraft.effectiveAt).toISOString().slice(0, 10)} onChange={(e) => setPriceDraft({ ...priceDraft, effectiveAt: new Date(e.target.value).getTime() })} />
        <div className="uadmin-actions"><Button variant="primary" disabled={!priceDraft.provider.trim() || !priceDraft.model.trim() || !priceDraft.sourceUrl.trim()} onClick={() => { onSaveModelPrice({ ...priceDraft, provider: priceDraft.provider.trim(), model: priceDraft.model.trim(), sourceUrl: priceDraft.sourceUrl.trim() }); setPriceDraft(EMPTY_PRICE); setEditingPrice(null) }}>{editingPrice ? 'Сохранить' : 'Добавить'}</Button>{editingPrice && <Button onClick={() => { setPriceDraft(EMPTY_PRICE); setEditingPrice(null) }}>Отмена</Button>}</div>
      </div>
    </section>
  )
}
