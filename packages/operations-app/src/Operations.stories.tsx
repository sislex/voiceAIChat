import type { Meta,StoryObj } from '@storybook/react'
import { Machines,MachineUtility,Explorer,LlmHistory,KnowledgeBase,CiMonitor,Diagnostics } from './surfaces'
const meta:Meta<typeof Machines>={title:'Operations/Surfaces',component:Machines}
export default meta
type Story=StoryObj<typeof Machines>
export const MachinesOnline:Story={args:{children:<p>MacBook · online · v1.2 · read-only · network · /work</p>}}
export const MachinesOffline:Story={args:{children:<p>Домашний ПК · offline</p>}}
export const Utility:Story={render:()=><MachineUtility><p>MacBook · Terminal · /work</p></MachineUtility>}
export const FileExplorer:Story={render:()=><Explorer><p>/work / src / index.ts</p></Explorer>}
export const History:Story={render:()=><LlmHistory><p>Claude · session · tokens · cost · live</p></LlmHistory>}
export const Knowledge:Story={render:()=><KnowledgeBase><p>Topics · search · related files</p></KnowledgeBase>}
export const CI:Story={render:()=><CiMonitor><p>Active and recent runs</p></CiMonitor>}
export const UserDiagnostics:Story={render:()=><Diagnostics><p>backend · session · machines · PTY · files · KB</p></Diagnostics>}
