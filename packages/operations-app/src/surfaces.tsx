import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import type { OperationsStore } from './store/operationsStore'
const Context=createContext<OperationsStore|null>(null)
export function OperationsProvider({store,children}:{store:OperationsStore;children:ReactNode}){return <Context.Provider value={store}>{children}</Context.Provider>}
export function useOperationsStore():OperationsStore{const store=useContext(Context);if(!store)throw new Error('OperationsProvider is not mounted');return store}
export function useOperations<T>(select:(state:ReturnType<OperationsStore['getState']>)=>T):T{const store=useOperationsStore();return useSyncExternalStore(store.subscribe,()=>select(store.getState()),()=>select(store.getState()))}
export interface OperationsSurfaceProps{children?:ReactNode;className?:string}
function Surface({title,children,className}:OperationsSurfaceProps&{title:string}){return <section className={`operations-surface ${className??''}`}><header><h2>{title}</h2></header>{children}</section>}
export const Machines=(props:OperationsSurfaceProps)=><Surface title="Машины" {...props}/>
export const MachineUtility=(props:OperationsSurfaceProps)=><Surface title="Утилита машины" {...props}/>
export const Explorer=(props:OperationsSurfaceProps)=><Surface title="Проводник" {...props}/>
export const LlmHistory=(props:OperationsSurfaceProps)=><Surface title="История LLM" {...props}/>
export const KnowledgeBase=(props:OperationsSurfaceProps)=><Surface title="База знаний" {...props}/>
export const CiMonitor=(props:OperationsSurfaceProps)=><Surface title="CI monitor" {...props}/>
export const Diagnostics=(props:OperationsSurfaceProps)=><Surface title="Диагностика" {...props}/>
