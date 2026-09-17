import type { Meta, StoryObj } from '@storybook/react'
import { CiTaskSettings } from './CiTaskSettings'
import { createFakeCi } from '@voicechat/ui-foundation/test/fakeApi'
import { DEFAULT_DEVELOPMENT_PREVIEW } from '@shared/developmentPreview'
import { DEFAULT_CI_BROWSER_CHECK, CI_PROCESS_STAGES } from '@shared/ci'

const meta: Meta<typeof CiTaskSettings> = {
  title:'CI/Development preview settings', component:CiTaskSettings,
  args:{section:'commands',projectId:'preview-demo',taskId:'preview-task'},
  decorators:[(Story)=>{
    const ci=createFakeCi()
    let browserCheck={...DEFAULT_CI_BROWSER_CHECK}, developmentPreview={...DEFAULT_DEVELOPMENT_PREVIEW}
    ci.getTaskCi=async()=>({config:{beforeModel:[],afterModel:[]},projectDefault:{beforeModel:[],afterModel:[]},overridden:false,enabledStages:[...CI_PROCESS_STAGES],browserCheck,developmentPreview})
    ci.putTaskCi=async(_p,_t,value)=>{
      browserCheck=value.browserCheck??browserCheck; developmentPreview=value.developmentPreview??developmentPreview
      return {beforeModel:[],afterModel:[],enabledStages:[...CI_PROCESS_STAGES],browserCheck,developmentPreview}
    }
    window.ci=ci
    return <Story />
  }]
}
export default meta
export const Default: StoryObj<typeof meta> = {}
