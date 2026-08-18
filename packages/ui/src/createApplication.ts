import{createAppRuntime,type AppModule,type ApplicationPorts,type AppRuntime}from'@voicechat/app-shell';import{createModuleRegistry}from'./moduleRegistry.js'
export interface CreateApplicationOptions{bridges:ApplicationPorts;modules?:readonly AppModule[]}
export function createApplication(options:CreateApplicationOptions):AppRuntime{return createAppRuntime(options.bridges,options.modules??createModuleRegistry())}
