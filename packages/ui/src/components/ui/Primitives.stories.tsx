// Витрина примитивов, на которых собраны страницы «Пользователи» и «Мой аккаунт».
//
// Показываем их вместе, а не по одному: половина решений здесь — про то, как
// элементы читаются рядом друг с другом (бейдж возле имени, счётчик во вкладке,
// подсказка под значением).
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { Avatar, Badge, MetricGrid, SearchField, Sparkline, StickyActionBar, Switch, Tabs, Toolbar, Button } from '@voicechat/ui-kit'

const meta: Meta = { title: 'UI/Primitives' }
export default meta
type Story = StoryObj

const row: React.CSSProperties = { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }

/** Аватары: цвет и инициалы выводятся из логина, подпись всегда контрастна. */
export const Avatars: Story = {
  render: () => (
    <div style={row}>
      {['alexey', 'marina', 'ipetrov', 'anna.k', 's_orlov', 'nikita'].map((name) => (
        <Avatar key={name} username={name} size={40} />
      ))}
    </div>
  )
}

/** Бейджи состояния: роль, активность, замок, версия агента. */
export const Badges: Story = {
  render: () => (
    <div style={row}>
      <Badge tone="accent">admin</Badge>
      <Badge tone="success">активен</Badge>
      <Badge tone="warning" title="Версия агента ниже актуальной">2.7.4 → 2.8.1</Badge>
      <Badge tone="danger">заблокирован</Badge>
      <Badge>observer</Badge>
    </div>
  )
}

/** Полоса метрик: подпись, число, пояснение с тональностью. */
export const Stats: Story = {
  render: () => (
    <MetricGrid
      columns={4}
      ariaLabel="Сводка"
      items={[
        { label: 'Всего пользователей', value: 24, hint: '+3 за месяц' },
        { label: 'Активны сейчас', value: 9, hint: 'по живым сессиям', tone: 'positive' },
        { label: 'Машины онлайн', value: '17 / 31', hint: '55% парка' },
        { label: 'Расход за месяц', value: '$842.40', hint: '78% лимитов', tone: 'warning' }
      ]}
    />
  )
}

/** Вкладки: стрелки, Home/End и счётчик. */
export const TabsRow: Story = {
  render: function TabsStory() {
    const [tab, setTab] = useState('overview')
    return (
      <Tabs
        label="Разделы пользователя"
        activeId={tab}
        onChange={setTab}
        items={[
          { id: 'overview', label: 'Обзор' },
          { id: 'access', label: 'Доступ' },
          { id: 'machines', label: 'Машины', count: 4 },
          { id: 'usage', label: 'Использование' },
          { id: 'history', label: 'История' }
        ]}
      />
    )
  }
}

/** Поиск и тумблер: две формы ввода, которыми управляется список и доступ. */
export const Controls: Story = {
  render: function ControlsStory() {
    const [query, setQuery] = useState('мар')
    const [on, setOn] = useState(true)
    return (
      <div style={{ display: 'grid', gap: 12, maxWidth: 320 }}>
        <SearchField value={query} onChange={setQuery} label="Имя пользователя" />
        <div style={row}>
          <Switch checked={on} onChange={setOn} label="Доступ к Anthropic Claude" />
          <span>Anthropic Claude</span>
        </div>
      </div>
    )
  }
}

/** Полоса несохранённых изменений — появляется только при правке. */
export const UnsavedChanges: Story = {
  render: function BarStory() {
    const [dirty, setDirty] = useState(true)
    return (
      <div style={{ minHeight: 160 }}>
        <Button onClick={() => setDirty((value) => !value)}>{dirty ? 'Скрыть полосу' : 'Показать полосу'}</Button>
        <StickyActionBar open={dirty} title="Есть несохранённые изменения" hint="Настройки доступа изменены">
          <Button size="sm" onClick={() => setDirty(false)}>Отменить</Button>
          <Button size="sm" variant="primary" onClick={() => setDirty(false)}>Сохранить</Button>
        </StickyActionBar>
      </div>
    )
  }
}

/** График расхода: своя математика, подпись для скринридера. */
export const SparklineChart: Story = {
  render: () => (
    <div style={{ maxWidth: 640 }}>
      <Sparkline
        label="Расход по дням, USD"
        format={(value) => `$${value.toFixed(2)}`}
        points={[2.4, 6.1, 4.8, 9.2, 7.3, 12.6, 8.1, 5.4, 11.9, 6.6].map((value, index) => ({ label: `${index + 1} авг`, value }))}
      />
    </div>
  )
}

/** Те же примитивы в тёмной теме: бейджи и полосы проверяем глазами, а не на светлом. */
export const Dark: Story = {
  render: () => (
    <div data-theme="dark" style={{ background: 'var(--bg)', color: 'var(--text)', padding: 16, display: 'grid', gap: 16 }}>
      <div style={row}>
        <Badge tone="accent">admin</Badge>
        <Badge tone="success">активен</Badge>
        <Badge tone="warning">2.7.4 → 2.8.1</Badge>
        <Badge tone="danger">заблокирован</Badge>
        <Badge>observer</Badge>
      </div>
      <MetricGrid
        columns={2}
        ariaLabel="Сводка в тёмной теме"
        items={[
          { label: 'Активны сейчас', value: 9, hint: 'по живым сессиям', tone: 'positive' },
          { label: 'Расход за месяц', value: '$842.40', hint: '78% лимитов', tone: 'warning' }
        ]}
      />
      <Toolbar summary={<><b>12</b> разрешено · <b>2</b> запрещено</>}>
        <Button size="sm" variant="ghost">Разрешить всё</Button>
      </Toolbar>
      <MetricGrid compact columns={2} ariaLabel="Свойства машины" items={[{ label: 'ОС', value: 'macOS 15.6' }, { label: 'Версия агента', value: '2.8.1' }]} />
      <Sparkline label="Расход по дням, USD" points={[3, 7, 5, 11, 8].map((value, index) => ({ label: `${index + 1} авг`, value }))} />
    </div>
  )
}

/** Пустой ряд: график не исчезает молча, а честно говорит «данных нет». */
export const SparklineEmpty: Story = {
  render: () => (
    <div style={{ maxWidth: 640 }}>
      <Sparkline label="Расход по дням, USD" points={[]} />
    </div>
  )
}
