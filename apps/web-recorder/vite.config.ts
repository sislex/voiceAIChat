import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
const abs = (p: string) => fileURLToPath(new URL(p, import.meta.url))
// Порты берутся из env теми же именами, что в apps/web/vite.config.ts: иначе
// второй чекаут монорепо (git worktree) не поднять параллельно с первым —
// оба Vite встанут на 5274 и оба будут проксировать в один backend.
const num = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
const RECORDER_PORT = num(process.env.VC_RECORDER_PORT, 5274)
const API_PORT = num(process.env.VC_API_PORT, 8787)
export default defineConfig({ base: '/web-recorder/', plugins:[react()], resolve:{ alias:[{find:'@voicechat/ui/app.css',replacement:abs('../../packages/ui/src/styles/app.css')},{find:'@voicechat/ui',replacement:abs('../../packages/ui/src/index.ts')},{find:/^@shared\//,replacement:abs('../../packages/shared/src/')},{find:'@voicechat/shared',replacement:abs('../../packages/shared/src/index.ts')}] }, server:{host:'127.0.0.1',port:RECORDER_PORT,proxy:{'/api':{target:`http://127.0.0.1:${API_PORT}`,changeOrigin:true}}} })
