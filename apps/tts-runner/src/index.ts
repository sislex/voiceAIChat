import { buildTtsRunner } from './server.js'
import { loadTtsRunnerConfig } from './config.js'
const config=loadTtsRunnerConfig()
if(!config.token){console.error('VC_TTS_RUNNER_TOKEN is required');process.exit(1)}
const app=await buildTtsRunner({config})
await app.listen({host:config.host,port:config.port})
