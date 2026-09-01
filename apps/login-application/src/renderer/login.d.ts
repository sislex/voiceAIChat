import type { LoginBridge } from '../preload/index'
declare global { interface Window { voicechatLogin: LoginBridge } }
export {}
