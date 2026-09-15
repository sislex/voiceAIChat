// Карточка человека целиком: шапка, быстрые факты, вкладки.
//
// Один и тот же компонент рисует чужой профиль в админке и свой на странице
// «Мой аккаунт». Разницу задают `capabilities` и наличие колбэков: страница «о
// себе» — это тот же экран без административных кнопок, а не другой экран.

import { useMemo, useState } from 'react'
import { Button, ErrorState, Skeleton, StickyActionBar, Tabs } from '@voicechat/ui-kit'
import type {
  ProfileAccessDenial,
  ProfileCallbacks,
  ProfileCapabilities,
  ProfileConversation,
  ProfilePeriod,
  ProfileProvider,
  ProfileSecurityEvent,
  ProfileTab,
  ProfileUsage,
  ProfileUser
} from './contracts'
import { READ_ONLY } from './contracts'
import { ProfileHead } from './ProfileHead'
import { QuickStats } from './QuickStats'
import { OverviewTab } from './tabs/OverviewTab'
import { AccessTab } from './tabs/AccessTab'
import { MachinesTab } from './tabs/MachinesTab'
import { UsageTab } from './tabs/UsageTab'
import { HistoryTab } from './tabs/HistoryTab'
import { BlockDialog } from './BlockDialog'
import type { SecurityGroup } from './securityLabels'
import { accessSummary } from './model'
import { PERIOD_LABEL } from './format'

export interface ProfilePanelProps extends ProfileCallbacks {
  roleHelp?: Partial<Record<import('./contracts').ProfileRole, string>>
  user: ProfileUser
  capabilities?: ProfileCapabilities
  /** Активная вкладка снаружи — вкладки живут в адресе страницы. */
  tab?: ProfileTab
  providers: readonly ProfileProvider[]
  denied: readonly ProfileAccessDenial[]
  usage: ProfileUsage | null
  period?: ProfilePeriod
  /** null — журнал ещё грузится; пустой массив — событий действительно нет. */
  events: readonly ProfileSecurityEvent[] | null
  /** Расход ещё грузится: показываем скелетон вместо пустого экрана. */
  usageLoading?: boolean
  /** Access loads independently from the profile shell. */
  accessLoading?: boolean
  /** Full machine details load only after the tab opens. */
  machinesLoading?: boolean
  /** Security history loads separately and never blocks the profile header. */
  eventsLoading?: boolean
  /** Группа событий журнала: фильтрует сервер, а не клиент. */
  securityGroup?: SecurityGroup
  onChangeSecurityGroup?: (group: SecurityGroup) => void
  /** Ошибка загрузки данных вкладки — видна в самой вкладке, а не только тостом. */
  error?: string | null
  onRetry?: () => void
  conversations?: readonly ProfileConversation[]
  latestAgentVersion?: string
  updatingMachineId?: string | null
  /** Окно «активен сейчас»: общая с сервером константа, а не своя догадка. */
  activeWindowMs?: number
  now?: number
  /** Дополнительный блок хоста внутри вкладки «Машины» — например список сессий. */
  sessionsSlot?: React.ReactNode
  /**
   * Блок хоста под журналом: администратору там показывают переписку человека.
   * Модуль профиля о чужих разговорах ничего не знает и знать не должен —
   * это администрирование, а не свойство профиля.
   */
  historySlot?: React.ReactNode
}

const TAB_LABEL: Record<ProfileTab, string> = {
  overview: 'Обзор',
  access: 'Доступ',
  machines: 'Машины',
  usage: 'Использование',
  history: 'История',
  sessions: 'Сессии и устройства'
}

export function ProfilePanel({
  roleHelp,
  user,
  capabilities = READ_ONLY,
  tab,
  providers,
  denied,
  usage,
  period = 'month',
  events,
  usageLoading = false,
  accessLoading = false,
  machinesLoading = false,
  eventsLoading = false,
  securityGroup = 'all',
  onChangeSecurityGroup,
  error = null,
  onRetry,
  conversations = [],
  latestAgentVersion,
  updatingMachineId = null,
  activeWindowMs = 5 * 60_000,
  now = Date.now(),
  sessionsSlot,
  historySlot,
  onChangeRole,
  onSetBlocked,
  onDelete,
  onSaveAccess,
  onUpdateMachine,
  onIssueResetCode,
  onSelectPeriod,
  onExportCsv,
  onChangeTab
}: ProfilePanelProps): JSX.Element {
  const [innerTab, setInnerTab] = useState<ProfileTab>(tab ?? 'overview')
  const active = tab ?? innerTab
  const [draft, setDraft] = useState<ProfileAccessDenial[] | null>(null)
  const [blockRequest, setBlockRequest] = useState<boolean | null>(null)

  const goTab = (next: ProfileTab): void => {
    setInnerTab(next)
    onChangeTab?.(next)
  }

  // Черновик прав живёт до явного сохранения: смена галочки в матрице доступа
  // не должна применяться мгновенно — человек ставит несколько и сохраняет разом.
  const effectiveDenied = draft ?? denied
  const summary = useMemo(() => accessSummary(effectiveDenied, providers), [effectiveDenied, providers])
  const totalModels = providers.reduce((sum, provider) => sum + provider.models.length, 0)
  const budget = user.llmLimitUsd != null && user.llmLimitUsd > 0 && usage ? usage.spendUsd / user.llmLimitUsd : null

  return (
    <section className="vcp" data-testid="profile-panel">
      <ProfileHead
        {...(roleHelp ? { roleHelp } : {})}
        user={user}
        capabilities={capabilities}
        now={now}
        activeWindowMs={activeWindowMs}
        {...(onChangeRole ? { onChangeRole } : {})}
        {...(onSetBlocked ? { onBlock: () => setBlockRequest(!user.blocked) } : {})}
        {...(onDelete ? { onDelete } : {})}
        {...(onIssueResetCode ? { onIssueResetCode } : {})}
      />

      <QuickStats user={user} access={accessLoading ? null : { allowed: summary.allowed, total: totalModels }} usage={usage} usageLoading={usageLoading} budget={budget} now={now} />

      <Tabs
        className="vcp-tabs"
        label="Разделы пользователя"
        activeId={active}
        onChange={(id) => goTab(id as ProfileTab)}
        panelId="profile-tabpanel"
        items={[
          { id: 'overview', label: TAB_LABEL.overview },
          { id: 'access', label: TAB_LABEL.access },
          { id: 'machines', label: TAB_LABEL.machines, count: user.machinesTotal ?? user.machines.length },
          { id: 'usage', label: TAB_LABEL.usage },
          { id: 'history', label: TAB_LABEL.history },
          ...(sessionsSlot ? [{ id: 'sessions', label: TAB_LABEL.sessions }] : [])
        ]}
      />

      <div className="vcp-panel" id="profile-tabpanel" role="tabpanel" aria-label={TAB_LABEL[active]}>
        {error && (
          <ErrorState
            compact
            message="Не удалось загрузить данные вкладки"
            detail={error}
            {...(onRetry ? { onRetry } : {})}
          />
        )}
        {usageLoading && active === 'usage' && (
          <Skeleton variant="list" count={2} height={96} lines={3} testId="profile-usage-skeleton" />
        )}
        {active === 'overview' && (
          <OverviewTab
            user={user}
            usage={usage}
            usageLoading={usageLoading}
            events={events}
            eventsLoading={eventsLoading}
            conversations={conversations}
            capabilities={capabilities}
            now={now}
            periodLabel={PERIOD_LABEL[period] ?? ''}
            onOpenHistory={() => goTab('history')}
            {...(onSetBlocked ? { onBlock: () => setBlockRequest(!user.blocked) } : {})}
          />
        )}
        {active === 'sessions' && sessionsSlot}
        {active === 'access' && (
          accessLoading
            ? <Skeleton variant="list" count={2} height={150} lines={4} testId="profile-access-skeleton" />
            : <AccessTab providers={providers} denied={effectiveDenied} capabilities={capabilities} onChange={setDraft} />
        )}
        {active === 'machines' && (
          machinesLoading
            ? <Skeleton variant="list" count={2} height={104} lines={3} testId="profile-machines-skeleton" />
            : <>
            <MachinesTab
              machines={user.machines}
              capabilities={capabilities}
              {...(latestAgentVersion ? { latestVersion: latestAgentVersion } : {})}
              now={now}
              {...(onUpdateMachine ? { onUpdateMachine } : {})}
              updatingId={updatingMachineId}
            />
          </>
        )}
        {!usageLoading && active === 'usage' && (
          <UsageTab usage={usage} period={period} {...(onSelectPeriod ? { onSelectPeriod } : {})} />
        )}
        {active === 'history' && (eventsLoading
          ? <Skeleton variant="list" count={4} height={72} lines={2} testId="profile-history-skeleton" />
          : (
          <>
            <HistoryTab
              events={events}
              userName={user.name}
              group={securityGroup}
              {...(onChangeSecurityGroup ? { onChangeGroup: onChangeSecurityGroup } : {})}
              {...(onExportCsv ? { onExportCsv } : {})}
            />
            {historySlot}
          </>
          ))}
      </div>

      <StickyActionBar
        open={draft !== null}
        title="Есть несохранённые изменения"
        hint={`Настройки доступа: ${summary.allowed} разрешено, ${summary.denied} запрещено`}
      >
        {/* Отмена возвращает права сервера, а не предыдущую правку черновика:
            «отменить» человек читает как «вернуть как было», а не «шаг назад». */}
        <Button size="sm" disabled={draft === null} onClick={() => setDraft(null)}>Отменить</Button>
        <Button
          size="sm"
          variant="primary"
          disabled={draft === null}
          onClick={() => {
            if (draft) onSaveAccess?.(draft)
            setDraft(null)
          }}
        >
          Сохранить
        </Button>
      </StickyActionBar>

      {blockRequest !== null && onSetBlocked && (
        <BlockDialog
          userName={user.name}
          blocking={blockRequest}
          onCancel={() => setBlockRequest(null)}
          onConfirm={(reason) => {
            onSetBlocked(blockRequest, reason)
            setBlockRequest(null)
          }}
        />
      )}
    </section>
  )
}
