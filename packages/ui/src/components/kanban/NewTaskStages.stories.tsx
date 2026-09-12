// Stage rail of the new task card ("Проект 19"): every status of the design in
// one place, plus the pipeline pass with checks and attempts. Presentational
// only — the functional panels inside are seeded through the fake bridges in
// the container stories.
import type { Meta, StoryObj } from '@storybook/react'
import { Badge } from '@voicechat/ui-kit'
import { AttemptList, CheckList, MetricTiles, StageCard, StageHeading, StageRail } from './NewTaskStages'
import type { TaskReworkCycleViewModel } from './TaskCardViewModel'
import { STAGE_STATUS_LABEL, type StageStatus } from './taskCycles'

const cycle: TaskReworkCycleViewModel = {
  id: 'c2', sequence: 2, description: 'Восстановление записи после потери сети\nСохранять аудио и продолжать отправку после повторного подключения.',
  criteria: ['Черновик хранится 24 часа', 'Статус озвучивается скринридером'], makeSources: [], attachments: [],
  createdBy: 'alex', createdAt: Date.UTC(2026, 8, 7, 12, 40), preparationRunId: 'prep-2', status: 'submitted'
}
const workflow = ['Подготовка', 'Ready', 'Development', 'Component QA', 'Automated QA', 'Merge', 'Done']

function Rail({ statuses }: { statuses: StageStatus[] }): JSX.Element {
  return <div style={{ padding: 18, background: 'var(--surface-sunken)' }}>
    <StageHeading eyebrow="История подготовки" title="Этапы подготовки к разработке" description="Каждый новый набор доработок готовится отдельно." badge={<Badge>{statuses.length} этапа</Badge>} />
    <StageRail>
      {statuses.map((status, index) => <StageCard
        key={status} number={index + 1} status={status} eyebrow={`Этап ${index + 1}`}
        title={index === 0 ? 'Подготовка задачи по первоначальному описанию' : `Подготовка к разработке доработки ${index + 1}`}
        workflow={workflow} cycle={index === 0 ? null : { ...cycle, id: `c${index}`, sequence: index + 1 }}
        sourceTitle="Источник этапа" sourceText="Первоначальное описание, критерии приёмки, файлы задачи и Make-дизайн."
        selected={index === statuses.length - 1} connector={index < statuses.length - 1}
        details={<p style={{ color: 'var(--text-dim)', margin: 0 }}>Лента этапа — {STAGE_STATUS_LABEL[status]}</p>}
      />)}
    </StageRail>
  </div>
}

const meta: Meta<typeof Rail> = { title: 'Kanban/NewTaskCard/Stages', component: Rail }
export default meta
type Story = StoryObj<typeof Rail>

export const PreparationRail: Story = { args: { statuses: ['success', 'running'] } }
export const AllStatuses: Story = { args: { statuses: ['idle', 'queued', 'running', 'waiting_for_answer', 'validating', 'paused', 'blocked', 'failed', 'timeout', 'cancelled', 'success', 'skipped'] } }
export const Dark: Story = { args: { statuses: ['success', 'failed', 'running'] }, globals: { theme: 'dark' } }
export const Mobile: Story = { args: { statuses: ['success', 'running'] }, parameters: { viewport: { defaultViewport: 'mobile1' } } }

export const PipelinePass: Story = {
  render: () => <div style={{ padding: 18, background: 'var(--surface-sunken)' }}>
    <StageHeading eyebrow="История проходов" title="Component QA" description="Отдельный проход для каждого development-цикла и набора доработок." badge={<Badge>2 прохода</Badge>} />
    <StageRail>
      <StageCard number={1} status="success" eyebrow="Проход 1" title="Component QA · первоначальная постановка" workflow={workflow} sourceTitle="Цикл 1" sourceText="Результат разработки первоначальной постановки задачи." connector>
        <CheckList checks={[{ id: 'a', title: 'Запуск прохода', note: '1 попытка', ok: true }, { id: 'b', title: 'Результат', note: 'Успешно · 4 сент. 2026', ok: true }]} />
      </StageCard>
      <StageCard number={2} status="failed" eyebrow="Проход 2" title="Component QA · доработка 2" workflow={workflow} cycle={cycle} selected>
        <CheckList checks={[{ id: 'a', title: 'Запуск прохода', note: '2 попытки', ok: true }, { id: 'b', title: 'Результат', note: 'Ошибка · 7 сент. 2026', ok: false }]} />
        <MetricTiles items={[{ label: 'Прогресс', value: '64%' }, { label: 'Шаги', value: '4/7' }, { label: 'Проверки', value: '14/22' }, { label: 'Время', value: '8м 14с' }]} />
        <AttemptList ariaLabel="Попытки" selectedId="b" attempts={[{ id: 'a', label: 'Попытка 1', status: 'cancelled', at: Date.UTC(2026, 8, 7, 10) }, { id: 'b', label: 'Попытка 2', status: 'failed', at: Date.UTC(2026, 8, 7, 12) }]} />
      </StageCard>
    </StageRail>
  </div>
}
