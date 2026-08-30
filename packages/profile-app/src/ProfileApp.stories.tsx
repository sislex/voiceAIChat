// Витрина карточки человека: те же данные, что приходят с сервера, в четырёх
// состояниях. Именно здесь видно главное свойство модуля — «Мой аккаунт» это
// тот же экран без административных кнопок, а не другой экран.
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { ProfilePanel } from './ProfilePanel'
import { FULL_ACCESS, READ_ONLY, type ProfileAccessDenial, type ProfilePeriod, type ProfileTab } from './contracts'
import { blockedUser, conversations, denied, emptyUsage, events, NOW, providers, usage, user } from './fixtures'

const meta: Meta<typeof ProfilePanel> = {
  title: 'Profile/ProfilePanel',
  component: ProfilePanel,
  parameters: { layout: 'fullscreen' }
}
export default meta
type Story = StoryObj<typeof ProfilePanel>

function Harness({ admin, tab = 'overview' }: { admin: boolean; tab?: ProfileTab }): JSX.Element {
  const [access, setAccess] = useState<ProfileAccessDenial[]>(denied)
  const [period, setPeriod] = useState<ProfilePeriod>('month')
  const [current, setCurrent] = useState<ProfileTab>(tab)
  return (
    <div style={{ background: 'var(--surface)', minHeight: '100vh' }}>
      <ProfilePanel
        user={user}
        capabilities={admin ? FULL_ACCESS : READ_ONLY}
        providers={providers}
        denied={access}
        usage={usage}
        period={period}
        events={events}
        conversations={conversations}
        latestAgentVersion="2.8.1"
        now={NOW}
        tab={current}
        onChangeTab={setCurrent}
        onSelectPeriod={setPeriod}
        onSaveAccess={admin ? setAccess : undefined}
        onSetBlocked={admin ? () => undefined : undefined}
        onChangeRole={admin ? () => undefined : undefined}
        onDelete={admin ? () => undefined : undefined}
        onIssueResetCode={admin ? () => undefined : undefined}
        onUpdateMachine={admin ? () => undefined : undefined}
        onExportCsv={() => undefined}
      />
    </div>
  )
}

/** Админ смотрит чужую учётку: доступны роль, блокировка, права, обновление машин. */
export const AdminView: Story = { render: () => <Harness admin /> }

/** Человек смотрит на себя: те же вкладки, ни одной административной кнопки. */
export const SelfView: Story = { render: () => <Harness admin={false} /> }

/** Матрица доступа с несохранённым черновиком — видна полоса «есть изменения». */
export const AccessMatrix: Story = { render: () => <Harness admin tab="access" /> }

/** Новая учётка: ни расхода, ни событий, ни разговоров. */
export const Empty: Story = {
  render: () => (
    <div style={{ background: 'var(--surface)', minHeight: '100vh' }}>
      <ProfilePanel
        user={{ ...user, name: 'newbie', machines: [], liveSessions: 0, lastSeenAt: null, llmLimitUsd: null, conversationCount: 0 }}
        capabilities={FULL_ACCESS}
        providers={providers}
        denied={[]}
        usage={emptyUsage}
        events={[]}
        conversations={[]}
        now={NOW}
        onSetBlocked={() => undefined}
      />
    </div>
  )
}

/** Заблокированная учётка глазами самого человека: причину видно, кнопок нет. */
export const Blocked: Story = {
  render: () => (
    <div style={{ background: 'var(--surface)', minHeight: '100vh' }}>
      <ProfilePanel
        user={blockedUser}
        capabilities={READ_ONLY}
        providers={providers}
        denied={denied}
        usage={usage}
        events={events}
        conversations={conversations}
        now={NOW}
      />
    </div>
  )
}

/** Телефон 390×844: рельса метрик в столбец, машины без горизонтального выезда. */
export const Mobile: Story = {
  render: () => <Harness admin />,
  parameters: { viewport: { defaultViewport: 'mobile2' } }
}
