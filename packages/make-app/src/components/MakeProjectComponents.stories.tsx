// Make Project mode showcase: expose offline machines, long Storybook builds, and working-copy
// permissions without needing a real machine and repository to reproduce them.
import type { Meta, StoryObj } from '@storybook/react'
import type { ProjectComponentsListing, ProjectStorybookSession } from '@shared/projectComponents'
import { makeGitFile, makeGitStatus, makeGitWorkspace } from '@voicechat/ui-foundation/test/fixtures/git'
import { makeProjectComponents, makeStorybookSession } from '@voicechat/ui-foundation/test/fixtures/projectComponents'
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
    'projects:storybookOpen': async () => ({
      kind: 'proxy' as const,
      url: '/api/preview?url=http%3A%2F%2Fm1.machine.internal%3A6006',
      tunnelId: null,
      note: 'Кадр идёт через мост машины.'
    }),
    'projects:storybookCloseTunnel': async () => ({ closed: true }),
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

/** Before Storybook starts, obtain the list from repository files. */
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

/** The first build is still running; report building until a preview is available. */
export const Starting: Story = {
  args: { api: api(makeStorybookSession({ state: 'starting', readyAt: null, log: 'storybook v8.6.14\nbuilding preview...\n' })) }
}

/** Ready state: components from the live index on the left, story frame on the right. */
export const Running: Story = {
  args: { api: api(makeStorybookSession()) }
}

/** When the process fails, show the reason and a log action instead of leaving a blank screen. */
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

/** Offline machine: preview and editing are unavailable; explain why controls are disabled. */
export const MachineOffline: Story = {
  args: {
    api: api(makeStorybookSession({ state: 'stopped' }), makeProjectComponents(), {
      'projects:gitWorkspaces': async () => [makeGitWorkspace({ online: false })]
    })
  }
}

/** Read-only working copy, such as a merge clone or a machine with read-only access. */
export const ReadOnly: Story = {
  args: {
    api: api(makeStorybookSession({ state: 'stopped' }), makeProjectComponents(), {
      'projects:gitWorkspaces': async () => [makeGitWorkspace({ writable: false, readOnlyReason: 'Машина открыта проекту только для чтения' })]
    })
  }
}

/** A repository without stories gets an empty state explaining the next step. */
export const NoComponents: Story = {
  args: {
    api: api(makeStorybookSession({ state: 'stopped' }), makeProjectComponents({ components: [], source: 'files' }))
  }
}

/** Show when the machine's output limit truncated the list. */
export const Truncated: Story = {
  args: { api: api(makeStorybookSession(), makeProjectComponents({ truncated: true } as Partial<ProjectComponentsListing>)) }
}
