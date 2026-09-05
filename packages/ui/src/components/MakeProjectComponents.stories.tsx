// Витрина режима «Проект» в Make. Состояния тут те, что в живом приложении ловятся
// офлайн-машиной, длинной сборкой Storybook и правами на рабочую копию, — увидеть их
// иначе можно было бы только на настоящей машине с настоящим репозиторием.
import type { Meta, StoryObj } from '@storybook/react'
import type { ProjectComponentsListing, ProjectStorybookSession } from '@shared/projectComponents'
import { makeGitFile, makeGitStatus, makeGitWorkspace } from '../test/fixtures/git'
import { makeProjectComponents, makeStorybookSession } from '../test/fixtures/projectComponents'
import { MakeProjectComponents, type MakeProjectComponentsApi } from './MakeProjectComponents'

function api(session: ProjectStorybookSession, listing = makeProjectComponents(), over: Partial<MakeProjectComponentsApi> = {}): MakeProjectComponentsApi {
  return {
    'projects:gitWorkspaces': async () => [makeGitWorkspace(), makeGitWorkspace({ id: 'project:m1', kind: 'project-worktree', taskId: null, taskSeq: null, taskTitle: null })],
    'projects:components': async () => listing,
    'projects:componentStories': async ({ path }) => ({ path, title: 'UI/Button', stories: [{ id: 'ui-button--primary', name: 'Primary' }] }),
    'projects:storybookSession': async () => session,
    'projects:storybookAction': async ({ action }) => ({ ...session, state: action === 'stop' ? 'stopped' : 'running' }),
    'projects:gitFile': async ({ path }) => makeGitFile({ path, content: "export const Button = (): JSX.Element => <button className=\"vc-btn\">Кнопка</button>\n" }),
    'projects:gitSaveFile': async ({ path, content }) => ({
      file: { path, ref: null, content, size: content.length, truncated: false, binary: false },
      status: makeGitStatus()
    }),
    'projects:componentTicket': async () => ({ taskId: 't-77', taskNumber: 77, branch: 'CHAT-77', commitSha: 'a'.repeat(40), columnId: 'col', readyToMerge: true }),
    ...over
  }
}

const meta: Meta<typeof MakeProjectComponents> = {
  title: 'Make/ProjectComponents',
  component: MakeProjectComponents,
  parameters: { layout: 'fullscreen' },
  args: { projectId: 'p1' }
}
export default meta
type Story = StoryObj<typeof MakeProjectComponents>

/** Storybook ещё не поднят: список берётся из файлов репозитория. */
export const Stopped: Story = {
  args: {
    api: api(
      makeStorybookSession({ state: 'stopped', readyAt: null, log: '' }),
      makeProjectComponents({
        source: 'files',
        components: [
          { path: 'packages/ui/src/components/ui/Button.stories.tsx', title: 'ui/Button', stories: [] },
          { path: 'packages/ui/src/components/VoiceBar.stories.tsx', title: 'components/VoiceBar', stories: [] }
        ]
      })
    )
  }
}

/** Идёт первая сборка: обещать кадр рано, поэтому состояние честно говорит «собирается». */
export const Starting: Story = {
  args: { api: api(makeStorybookSession({ state: 'starting', readyAt: null, log: 'storybook v8.6.14\nbuilding preview...\n' })) }
}

/** Рабочее состояние: слева компоненты живого индекса, справа кадр стори. */
export const Running: Story = {
  args: { api: api(makeStorybookSession()) }
}

/** Процесс упал: показываем причину и отправляем в лог, а не оставляем пустой экран. */
export const Failed: Story = {
  args: {
    api: api(makeStorybookSession({
      state: 'failed',
      readyAt: null,
      error: 'Storybook завершился, не успев собраться — смотрите лог',
      log: 'Error: Cannot find module "@storybook/react-vite"\n'
    }))
  }
}

/** Машина офлайн: ни кадра, ни правки — объясняем, почему кнопки недоступны. */
export const MachineOffline: Story = {
  args: {
    api: api(makeStorybookSession({ state: 'stopped' }), makeProjectComponents(), {
      'projects:gitWorkspaces': async () => [makeGitWorkspace({ online: false })]
    })
  }
}

/** Копия только для чтения (merge-клон или машина, открытая на чтение). */
export const ReadOnly: Story = {
  args: {
    api: api(makeStorybookSession({ state: 'stopped' }), makeProjectComponents(), {
      'projects:gitWorkspaces': async () => [makeGitWorkspace({ writable: false, readOnlyReason: 'Машина открыта проекту только для чтения' })]
    })
  }
}

/** В репозитории нет сториз: пустота объясняет следующий шаг. */
export const NoComponents: Story = {
  args: {
    api: api(makeStorybookSession({ state: 'stopped' }), makeProjectComponents({ components: [], source: 'files' }))
  }
}

/** Список обрезан лимитом вывода машины — это видно, а не теряется молча. */
export const Truncated: Story = {
  args: { api: api(makeStorybookSession(), makeProjectComponents({ truncated: true } as Partial<ProjectComponentsListing>)) }
}
