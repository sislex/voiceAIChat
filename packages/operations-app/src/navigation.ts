import type { OperationsHostContext } from './contracts'
import { buildOperationsRoute, parseOperationsRoute, type OperationsRoute } from './routes'
export interface OperationsNavigationItem { id: 'machines'|'claude'|'codex'|'kb'|'ci'; label: string; route: string; visible: boolean; active: boolean }
export type OperationsNavigationModel = readonly OperationsNavigationItem[]
export function createOperationsNavigationModel(hash: string, context: OperationsHostContext): OperationsNavigationModel {
  const active = parseOperationsRoute(hash)
  const is = (route: OperationsRoute) => JSON.stringify(active) === JSON.stringify(route)
  return [
    { id:'machines', label:'Машины', route:buildOperationsRoute({page:'machines'}), visible:context.authenticated, active:is({page:'machines'}) },
    { id:'claude', label:'Claude Code', route:buildOperationsRoute({page:'history',engine:'claude'}), visible:context.authenticated, active:is({page:'history',engine:'claude'}) },
    { id:'codex', label:'Codex', route:buildOperationsRoute({page:'history',engine:'codex'}), visible:context.authenticated, active:is({page:'history',engine:'codex'}) },
    { id:'kb', label:'База знаний', route:buildOperationsRoute({page:'knowledge'}), visible:context.authenticated, active:active?.page === 'knowledge' },
    { id:'ci', label:'CI', route:buildOperationsRoute({page:'ci'}), visible:context.authenticated, active:is({page:'ci'}) }
  ]
}
