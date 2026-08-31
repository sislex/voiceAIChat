// Витрина языка панелей рана: лозенга состояния, шапка панели, сводка, шаги,
// прогресс, лента события и подразделы.
//
// Все десять вкладок карточки задачи собраны из этих семи примитивов — сториз
// показывает их по отдельности и «как это выглядит вместе», чтобы расхождение
// между вкладками было видно в витрине, а не в проде.
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import {
  FeedItem,
  FeedLog,
  LiveIndicator,
  MetricGrid,
  PanelHeading,
  ProgressRing,
  ProgressTrack,
  StatusPill,
  StepList,
  SubTabs,
  type StatusTone
} from '@voicechat/ui-kit'

const TONES: StatusTone[] = ['neutral', 'accent', 'running', 'success', 'warning', 'danger']
const TONE_LABEL: Record<StatusTone, string> = {
  neutral: 'Не запускалось',
  accent: 'Выделено',
  running: 'Выполняется',
  success: 'Успешно',
  warning: 'Требует внимания',
  danger: 'Не пройдено'
}

const meta: Meta = {
  title: 'UI/Run panels',
  parameters: {
    docs: {
      description: {
        component:
          'Язык панелей рана. Тон — семантический (`running`/`warning`), а не цвет: ' +
          'правило «жёлтый» пришлось бы помнить на месте вызова, а `warning` переживает ' +
          'смену палитры и тёмную тему. Прогресс всегда объявляет себя скринридеру — ' +
          'у ProgressTrack и ProgressRing поле label обязательное.'
      }
    }
  }
}
export default meta
type Story = StoryObj

export const Tones: Story = {
  name: 'Лозенги состояния',
  render: () => (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {TONES.map((tone) => (
        <StatusPill key={tone} tone={tone}>{TONE_LABEL[tone]}</StatusPill>
      ))}
    </div>
  )
}

export const Heading: Story = {
  name: 'Шапка панели',
  render: () => (
    <div style={{ display: 'grid', gap: 24, maxWidth: 760 }}>
      <PanelHeading
        kicker="Попытка 2"
        title="Подготовка к разработке"
        description="Анализ требований и подготовка рабочего окружения."
        actions={<StatusPill tone="success">Успешно</StatusPill>}
      />
      <PanelHeading
        kicker="Development run #12"
        title="Ход выполнения"
        description="Запуск активен · работает 08:24"
        actions={<LiveIndicator />}
      />
      <PanelHeading title="Слияние изменений" description="task/CHAT-248 → main" />
    </div>
  )
}

export const Summary: Story = {
  name: 'Сводка рана',
  render: () => (
    <div style={{ maxWidth: 760 }}>
      <MetricGrid
        items={[
          { label: 'Длительность', value: '4 мин 18 сек' },
          { label: 'Машина', value: 'MacBook · online' },
          { label: 'Модель', value: 'Codex / GPT-5' }
        ]}
      />
    </div>
  )
}

export const Steps: Story = {
  name: 'Шаги этапа',
  render: () => (
    <div style={{ maxWidth: 620, border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
      <StepList
        steps={[
          { title: 'Исследование кода', detail: 'Завершено за 2:12', state: 'done' },
          { title: 'Реализация', detail: 'Изменено 6 файлов · +284 −31', state: 'running' },
          { title: 'Проверки', detail: 'Ожидает' },
          { title: 'Доставка', detail: 'Ожидает' }
        ]}
      />
    </div>
  )
}

export const FailedStep: Story = {
  name: 'Шаги: упавший этап',
  render: () => (
    <div style={{ maxWidth: 620 }}>
      <StepList
        steps={[
          { title: 'TypeScript', detail: 'Ошибок нет', state: 'done' },
          { title: 'Lint', detail: '0 предупреждений', state: 'done' },
          { title: 'Coverage', detail: '76% при пороге 80%', state: 'failed' }
        ]}
      />
    </div>
  )
}

export const Progress: Story = {
  name: 'Прогресс: полоса и кольцо',
  render: () => (
    <div style={{ display: 'grid', gap: 24, maxWidth: 520 }}>
      <ProgressTrack value={2} max={3} label="Подзадачи" />
      <ProgressTrack value={7} max={9} label="Сценарии интеграционных тестов" tone="success" />
      <ProgressTrack value={76} max={100} label="Покрытие изменённых строк" tone="warning" compact />
      <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
        <ProgressRing value={68} label="Ход выполнения" />
        <ProgressRing value={12} max={12} label="Сценарии Component QA" caption="12/12" tone="success" />
        <ProgressRing value={0} label="Ещё не начиналось" tone="neutral" />
      </div>
    </div>
  )
}

export const Feed: Story = {
  name: 'Лента рана',
  render: () => (
    <div className="vc-feed" style={{ maxWidth: 620 }}>
      <FeedItem title="Реализация API поиска" tone="success" meta="11:24" defaultOpen>
        <FeedLog label="Лог шага">
          {'Updated apps/server/src/routes/conversations.ts\nAdded FTS query with ranked results\n✓ typecheck passed'}
        </FeedLog>
      </FeedItem>
      <FeedItem title="Исследование кодовой базы" tone="running" meta="11:17">
        <p style={{ margin: 0, padding: '0 14px 14px', color: 'var(--text-dim)', fontSize: 12 }}>
          Найдены точки интеграции UI, store и серверного маршрута.
        </p>
      </FeedItem>
      <FeedItem title="Запуск создан" meta="11:15" />
      <FeedItem title="Автопроверка упала" tone="danger" meta="11:31">
        <FeedLog label="Лог проверки">{'coverage 76% < threshold 80%'}</FeedLog>
      </FeedItem>
    </div>
  )
}

export const Subtabs: Story = {
  name: 'Подразделы панели',
  render: function SubtabsStory() {
    const [value, setValue] = useState('overview')
    return (
      <div style={{ maxWidth: 620 }}>
        <SubTabs
          ariaLabel="Разделы хода выполнения"
          value={value}
          onChange={setValue}
          items={[
            { id: 'overview', label: 'Обзор' },
            { id: 'model', label: 'Работа модели' },
            { id: 'checks', label: 'Проверки', count: 3 },
            { id: 'changes', label: 'Изменения' },
            { id: 'kb', label: 'База знаний' },
            { id: 'delivery', label: 'Доставка' }
          ]}
        />
        <p style={{ marginTop: 16, fontSize: 13, color: 'var(--text-dim)' }}>Выбрано: {value}</p>
      </div>
    )
  }
}

export const Together: Story = {
  name: 'Панель целиком',
  render: () => (
    <div style={{ maxWidth: 760 }}>
      <PanelHeading
        kicker="Automated QA · попытка 1"
        title="Quality gate"
        description="Автоматическая итоговая проверка изменений."
        actions={<StatusPill tone="warning">Требует внимания</StatusPill>}
      />
      <MetricGrid
        items={[
          { label: 'Длительность', value: '1 мин 04 сек' },
          { label: 'Машина', value: 'MacBook · online' },
          { label: 'Проверок', value: '3' }
        ]}
      />
      <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
        <StepList
          steps={[
            { title: 'TypeScript', detail: 'Ошибок нет', state: 'done' },
            { title: 'Lint', detail: '0 предупреждений', state: 'done' },
            { title: 'Coverage', detail: '76% при пороге 80%', state: 'failed' }
          ]}
        />
      </div>
      <div className="vc-feed" style={{ marginTop: 16 }}>
        <FeedItem title="Отчёт гейта" meta="38 строк">
          <FeedLog>{'$ npm run gate\n✗ coverage 76% < 80%'}</FeedLog>
        </FeedItem>
      </div>
    </div>
  )
}
