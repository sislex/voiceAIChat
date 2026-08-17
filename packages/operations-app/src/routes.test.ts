import { describe,it,expect } from 'vitest'
import { buildOperationsRoute,parseOperationsRoute } from './routes'
import { isPathAllowed,machineBreadcrumbs,normalizeMachinePath } from './path'
describe('operations routes',()=>{it.each(['#/machines','#/claude-code','#/codex','#/kb','#/kb/a%2Fb','#/ci'])('round trips %s',(hash)=>{const route=parseOperationsRoute(hash);expect(route).not.toBeNull();expect(buildOperationsRoute(route!)).toBe(hash)})})
describe('machine paths',()=>{it('normalizes POSIX and Windows',()=>{expect(normalizeMachinePath('/a/../b')).toBe('/b');expect(normalizeMachinePath('c:\\work\\..\\src')).toBe('C:\\src')});it('keeps paths in allowed roots',()=>{expect(isPathAllowed('/work/app',['/work'])).toBe(true);expect(isPathAllowed('/worker',['/work'])).toBe(false);expect(machineBreadcrumbs('C:\\work\\app')).toEqual(['C:\\','C:\\work','C:\\work\\app'])})})
