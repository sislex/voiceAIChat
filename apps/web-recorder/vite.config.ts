import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
const abs = (p: string) => fileURLToPath(new URL(p, import.meta.url))
export default defineConfig({ plugins:[react()], resolve:{ alias:[{find:'@voicechat/ui/app.css',replacement:abs('../../packages/ui/src/styles/app.css')},{find:'@voicechat/ui',replacement:abs('../../packages/ui/src/index.ts')},{find:/^@shared\//,replacement:abs('../../packages/shared/src/')},{find:'@voicechat/shared',replacement:abs('../../packages/shared/src/index.ts')}] }, server:{port:5274,proxy:{'/api':{target:'http://127.0.0.1:8787',changeOrigin:true}}} })
