import type{ComponentType}from'react';import type{AppModule}from'@voicechat/app-shell';import{parseChatRoute,buildChatRoute}from'@voicechat/chat-app';import{parseProjectsRoute,buildProjectsRoute}from'@voicechat/projects-app';import{parseOperationsRoute,buildOperationsRoute}from'@voicechat/operations-app';import{parseAdminRoute,buildAdminRoute}from'@voicechat/admin-app'
type Parser=(hash:string)=>unknown|null;type Builder=(route:never)=>string
function lazyModule(id:string,parser:Parser,builder:Builder,examples:readonly string[],loadRender:()=>Promise<ComponentType<{route:unknown;store:unknown}>>,roles?:readonly string[]):AppModule{return{id,...(roles?{roles}:{}),routes:{examples,parse(hash){const route=parser(hash);return route?{route}:null},build:route=>builder(route as never)},async load(){return{render:await loadRender()}}}}
export function createModuleRegistry():readonly AppModule[]{return[
lazyModule('chat',parseChatRoute,buildChatRoute as Builder,['#/','#/chat/example'],async()=>{const m=await import('@voicechat/chat-app');return m.ChatApp as never}),
lazyModule('projects',parseProjectsRoute,buildProjectsRoute as Builder,['#/projects','#/projects/example'],async()=>{const m=await import('@voicechat/projects-app');return m.ProjectsApp as never}),
lazyModule('operations',parseOperationsRoute,buildOperationsRoute as Builder,['#/machines','#/claude-code','#/codex','#/kb','#/ci'],async()=>{const m=await import('@voicechat/operations-app');return m.Machines as never}),
lazyModule('admin',parseAdminRoute,buildAdminRoute as Builder,['#/users'],async()=>{const m=await import('@voicechat/admin-app');return m.UsersAdmin as never},['admin'])
]}
