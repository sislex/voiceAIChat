import type { Meta, StoryObj } from '@storybook/react'
import { NewTaskMergePanel } from './NewTaskMergePanel'
import { queuedMergeCi } from '../../test/fixtures/queuedMerge'

export default {
  title: 'Kanban/NewTaskMergePanel',
  component: NewTaskMergePanel,
  args: { projectId: 'p1', taskId: 't1', cycles: [], workflow: [], activeRunId: 'queued-475', canStart: false },
  decorators: [Story => { window.ci = queuedMergeCi(); return <Story /> }]
} satisfies Meta<typeof NewTaskMergePanel>
export const Queued: StoryObj<typeof NewTaskMergePanel> = {}
