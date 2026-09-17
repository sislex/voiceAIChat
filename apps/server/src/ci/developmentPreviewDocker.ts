import { createHash, randomBytes } from 'node:crypto'
import { APPLICATION_CATALOG, PREVIEW_CLI_GRANTS_PATH } from '@voicechat/shared'
import type { CommandExecutor } from './types.js'
import { DevelopmentPreviewError, redactPreviewLog, type DevelopmentPreviewRuntime, type PreviewRuntimeInput, type PreviewRuntimeHandle } from './developmentPreview.js'

const quote = (value: string): string => "'" + value.replace(/'/g, "'\\''") + "'"
const digestImage = (value: string | undefined): value is string => !!value && /^(?:[a-zA-Z0-9./:_-]+@)?sha256:[a-f0-9]{64}$/.test(value)
interface Engine { id: string; baseUrl: string; token: string }
/** Image and network policy are operator configuration, never supplied by task code. */
export interface DevelopmentDockerDeps {
  executor: CommandExecutor
  enabled: boolean
  image?: string
  guardImage?: string
  engine(input: PreviewRuntimeInput, id?: string): Promise<Engine | null>
  closeBrowser?(input: PreviewRuntimeInput): Promise<void>
}
const SNAPSHOT = String.raw`
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process'), crypto = require('node:crypto');
const root = fs.realpathSync(process.cwd()), out = process.argv[1];
const sourceSha=cp.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const files = cp.execFileSync('git', ['ls-files','-co','--exclude-standard','-z'], {encoding:'utf8'}).split('\0').filter(Boolean);
const parent=path.dirname(out);
if(fs.realpathSync(path.dirname(parent))!==path.dirname(root)||fs.existsSync(parent))throw Error('isolation_rejected_snapshot_root');
fs.mkdirSync(parent,{mode:448});fs.mkdirSync(out,{mode:448});
fs.mkdirSync(path.join(out,'node_modules'),{recursive:true});
const hash = crypto.createHash('sha256');
for (const rel of [...new Set(files)].sort()) {
  if (rel.split(/[\\/]/).some(p => p === '..' || p === '.git' || p === 'node_modules' || p === '.claude' || p === '.codex' || p === '.ssh' || p === '.aws' || p === '.kube' || p === '.gnupg' || p === '.config' || p === '.npmrc' || p === '.netrc' || p === 'cli-users' || p.startsWith('.env')) ||
      /(?:^|\/)(?:auth|credentials|cookies|secrets?)(?:\.(?:json|toml|ya?ml|env))?$|\.(?:db|sqlite|sqlite3|pem|key|p12|pfx|bak|dump|sql)$/i.test(rel)) continue;
  const source = path.resolve(root, rel);
  if (!source.startsWith(root + path.sep)) throw Error('isolation_rejected');
  const pieces = rel.split('/');
  let current = root;
  for (const piece of pieces) { current = path.join(current,piece); if (fs.lstatSync(current).isSymbolicLink()) throw Error('isolation_rejected_symlink'); }
  const stat = fs.statSync(source);
  if (!stat.isFile()) continue;
  if (stat.size > 20 * 1024 * 1024) throw Error('isolation_rejected_large_file');
  const target = path.join(out,rel); fs.mkdirSync(path.dirname(target),{recursive:true});
  const data=fs.readFileSync(source);fs.writeFileSync(target,data,{mode:stat.mode & 511});hash.update(rel);hash.update(data);
}
if(cp.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==sourceSha)throw Error('isolation_rejected_source_changed');
console.log(JSON.stringify({sha:sourceSha,sourceDigest:hash.digest('hex')}));
`
const GATEWAY = String.raw`
const http=require('node:http'),https=require('node:https');
const target=new URL(process.env.UPSTREAM);
http.createServer((req,res)=>{
  if(req.method!=='POST'||req.url!=='/v1/run'){res.writeHead(403);return res.end();}
  const upstream=(target.protocol==='https:'?https:http).request(new URL('/v1/run',target),{
    method:'POST',headers:{authorization:'Bearer '+process.env.SCOPED_TOKEN,'content-type':'application/json'},timeout:120000
  },r=>{res.writeHead(r.statusCode,{'content-type':'application/x-ndjson','cache-control':'no-store'});r.pipe(res)});
  upstream.on('error',()=>{res.writeHead(502);res.end('gateway_unavailable')});
  upstream.on('timeout',()=>upstream.destroy());
  res.on('close',()=>upstream.destroy());
  let body='';
  req.on('data',chunk=>{body+=chunk;if(body.length>64000){upstream.destroy();res.writeHead(413);res.end();req.destroy()}});
  req.on('end',()=>{try{const input=JSON.parse(body);if(typeof input.prompt!=='string')throw Error('invalid');upstream.end(JSON.stringify({prompt:input.prompt,kind:process.env.KIND,model:process.env.MODEL,sessionId:null}))}catch{upstream.destroy();res.writeHead(400);res.end()}});
}).listen(8790,'0.0.0.0');
http.createServer((req,res)=>{
  const upstream=http.request({hostname:'guard',port:Number(process.env.APP_PORT),path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});
  upstream.on('error',()=>{res.writeHead(502);res.end('preview_unavailable')});res.on('close',()=>upstream.destroy());req.pipe(upstream);
}).listen(Number(process.env.APP_PORT),'0.0.0.0');
`
export function previewCompose(input: PreviewRuntimeInput, resource: string, image: string, guardImage: string, upstream: string, scopedToken: string, password: string, command: string): Record<string, unknown> {
  if (!digestImage(image) || !digestImage(guardImage) || !/^vc-dev-[a-f0-9]{32}$/.test(resource)) throw new DevelopmentPreviewError('isolation_rejected', 'Pinned trusted runtime and guard images are required')
  const buildCore = input.settings.startCommand === 'auto' && ['auto','core'].includes(input.settings.application)
  const base = { read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'], restart: 'no', pids_limit: 256, mem_limit: '1g', cpus: 1, logging: { driver: 'json-file', options: { 'max-size': '1m', 'max-file': '2' } } }
  return {
    name: resource,
    services: {
      ...(buildCore ? { build: { ...base, image, profiles:['build'], user:'0:0', working_dir:'/app', network_mode:'none',
        entrypoint:['/bin/sh','-ec','npm run -w @voicechat/web build'],
        volumes:['./source:/app:rw','dependencies:/app/node_modules'],
        environment:{ NODE_ENV:'production', HOME:'/tmp', npm_config_cache:'/tmp/npm-cache' },
        tmpfs:['/tmp:rw,nosuid,size=128m'], mem_limit:'2g' } } : {}),
      gateway: { ...base, image, entrypoint: ['node','-e',GATEWAY], networks: { private:{}, egress:{gw_priority:1} },
        environment: { UPSTREAM: upstream, SCOPED_TOKEN: scopedToken, APP_PORT:String(input.settings.containerPort), KIND:input.kind, MODEL:input.model }, volumes: [], mem_limit: '128m',
        ports: [{ target: input.settings.containerPort, host_ip:'127.0.0.1', published:'0', protocol:'tcp' }] },
      guard: { ...base, image: guardImage, user:'0:0', cap_add: ['NET_ADMIN'], networks: ['private'],
        entrypoint: ['/bin/sh','-ec', 'GW=$(getent hosts gateway | awk \'{print $1; exit}\'); test -n "$GW"; iptables -P OUTPUT DROP; ip6tables -P OUTPUT DROP; iptables -A OUTPUT -o lo -j ACCEPT; iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT; iptables -A OUTPUT -d "$GW" -p tcp --dport 8790 -j ACCEPT; touch /tmp/ready; exec sleep infinity'],
        tmpfs: ['/tmp:rw,noexec,nosuid,size=1m'], depends_on: { gateway: { condition:'service_started' } },
        healthcheck: { test:['CMD','test','-f','/tmp/ready'], interval:'1s',timeout:'1s',retries:30 } },
      app: { ...base, image, user:'0:0', working_dir:'/app', entrypoint:['/bin/sh','-ec',command],
        network_mode:'service:guard', depends_on: { guard: { condition:'service_healthy' } },
        volumes: ['./source:/app:ro','dependencies:/app/node_modules','test-data:/preview-data'],
        tmpfs: ['/tmp:rw,nosuid,size=128m'],
        environment: {
          NODE_ENV:'test', HOST:'0.0.0.0', PORT:String(input.settings.containerPort),
          ...(buildCore ? { VC_WEB_DIR:'/app/apps/web/dist' } : {}),
          VC_DATA_DIR:'/preview-data', VC_DB_PATH:'/preview-data/test.sqlite', VC_ADMIN_PASSWORD:password,
          VC_DEVELOPMENT_PREVIEW:'true', VC_PREVIEW_SEED:input.settings.database.seed,
          VC_CLAUDE_BIN:'/bin/false', VC_CODEX_BIN:'/bin/false', VC_KB_RERANK_PROVIDER:'disabled',
          VC_LLM_RUNNER_URL:'http://gateway:8790', VC_LLM_RUNNER_TOKEN:scopedToken
        } }
    },
    networks: { private: { internal:true }, egress: {} },
    volumes: { 'test-data': {}, dependencies: {} }
  }
}
export function createDevelopmentDockerRuntime(deps: DevelopmentDockerDeps): DevelopmentPreviewRuntime {
  const runSecrets = new Map<string, string[]>()
  const root = (i: PreviewRuntimeInput, h: PreviewRuntimeHandle): string => i.workspace + '/../.' + h.resourceName
  const compose = (i: PreviewRuntimeInput, h: PreviewRuntimeHandle): string => 'docker compose --project-name ' + quote(h.resourceName) + ' --file ' + quote(root(i,h) + '/compose.json')
  async function exec(i: PreviewRuntimeInput, script: string, signal?: AbortSignal, secrets: string[] = [], timeoutMs = i.settings.startupTimeoutMs): Promise<string> {
    let output = ''
    const result = await deps.executor.run({ agentId:i.agentId, workdir:i.workspace, script, env:{}, timeoutMs, secrets },
      async (chunk) => { output = (output + chunk).slice(-100000) }, signal)
    if (result.exitCode !== 0 || result.timedOut) {
      const safe = redactPreviewLog(output,secrets)
      const code = result.timedOut ? 'health_timeout' : /command not found.*docker|docker.*not found/i.test(safe) ? 'docker_missing' : /daemon|connect.*docker/i.test(safe) ? 'docker_unavailable' : /isolation_rejected/i.test(safe) ? 'isolation_rejected' : 'application_failed'
      throw new DevelopmentPreviewError(code, safe || 'Machine command failed')
    }
    return output
  }
  return {
    async prepare(input, handle, signal, log) {
      if (!deps.enabled) throw new DevelopmentPreviewError('feature_disabled','Development preview is disabled by operator configuration')
      if (!input.agentId) throw new DevelopmentPreviewError('machine_unavailable','No machine assigned to this run')
      if (!digestImage(deps.image) || !digestImage(deps.guardImage)) throw new DevelopmentPreviewError('isolation_rejected','Configure pinned trusted runtime and network guard images')
      await exec(input,'docker info --format "{{.ServerVersion}}"',signal)
      const engine = await deps.engine(input)
      if (!engine) throw new DevelopmentPreviewError('gateway_unavailable','No production LLM Runner is available')
      handle.runnerId = engine.id
      const grantResponse = await fetch(engine.baseUrl + PREVIEW_CLI_GRANTS_PATH, {
        method:'POST', headers:{authorization:'Bearer ' + engine.token,'content-type':'application/json'},
        body:JSON.stringify({ projectId:input.projectId,taskId:input.taskId,runId:input.runId,userId:input.userId,kind:input.kind,model:input.model,ttlMs:input.settings.ttlMs,operations:['generate'] }),
        signal
      }).catch(() => { throw new DevelopmentPreviewError('gateway_unavailable','Production gateway is unreachable') })
      if (!grantResponse.ok) throw new DevelopmentPreviewError('gateway_unavailable','Production Runner rejected scoped generation capability')
      const grant = await grantResponse.json() as {id:string;token:string}
      handle.grantId = grant.id
      await log('Scoped gateway capability issued. Preparing isolated source and database.\n')
      const app = APPLICATION_CATALOG.find((a) => a.id === (input.settings.application === 'auto' ? 'core' : input.settings.application))
      const command = input.settings.startCommand === 'auto' ? app?.entrypoint ? 'node_modules/.bin/tsx ' + quote(app.entrypoint) : null : input.settings.startCommand
      if (!command || app?.id === 'llm-runner') throw new DevelopmentPreviewError('isolation_rejected','Application requires an explicit startup command; CLI executors cannot run inside preview')
      const location = root(input,handle), secrets = [grant.token,engine.token]
      handle.resourcesCreated = true
      await log('Creating disposable source snapshot.\n')
      const snapshot = await exec(input,'node -e ' + quote(SNAPSHOT) + ' ' + quote(location + '/source'),signal,secrets)
      const source = JSON.parse(snapshot.trim().split('\n').at(-1)!) as {sha:string;sourceDigest:string}
      const password = randomBytes(24).toString('hex'); secrets.push(password)
      runSecrets.set(input.runId, secrets)
      const config = previewCompose(input,handle.resourceName,deps.image,deps.guardImage,engine.baseUrl,grant.token,password,command)
      const dollar = String.fromCharCode(36)
      const data = JSON.stringify(config, (_key, value: unknown) => typeof value === 'string' ? value.split(dollar).join(dollar + dollar) : value)
      await exec(input, 'node -e ' + quote("require('node:fs').writeFileSync(process.argv[1],process.argv[2],{mode:384})") + ' ' + quote(location + '/compose.json') + ' ' + quote(data),signal,secrets)
      await log('Starting private network, isolated test-data volume and application migrations.\n')
      if (input.settings.startCommand === 'auto' && app?.id === 'core') {
        await log('Building core web assets from the source snapshot with network disabled.\n')
        try { await exec(input,compose(input,handle) + ' run --rm --no-deps build',signal,secrets) }
        catch (error) { throw new DevelopmentPreviewError('build_failed', error instanceof Error ? error.message : 'Offline frontend build failed') }
      }
      await exec(input,compose(input,handle) + ' up -d --wait',signal,secrets)
      let port: string | undefined
      for (let attempt = 0; attempt < 10 && !port; attempt++) {
        const binding = await exec(input,compose(input,handle) + ' port gateway ' + input.settings.containerPort,signal,secrets)
        port = /127\.0\.0\.1:(\d+)/.exec(binding)?.[1]
        if (!port) await new Promise((resolve) => setTimeout(resolve,500))
      }
      if (!port) throw new DevelopmentPreviewError('network_unavailable','Dynamic loopback port was not published')
      let healthAttempts = 0
      while (!signal.aborted && ++healthAttempts <= 60) {
        try {
          await exec(input,'curl --fail --silent --max-time 2 --output /dev/null ' + quote('http://127.0.0.1:' + port + input.settings.healthPath),signal,secrets,5000)
          await log('Isolated application and database are ready.\n')
          return { sha:source.sha,configDigest:createHash('sha256').update(source.sourceDigest + JSON.stringify({settings:input.settings,image:deps.image,guard:deps.guardImage})).digest('hex'),
            url:'http://' + input.agentId + '.machine.internal:' + port + input.check.startPath,healthAttempts }
        } catch { if (signal.aborted) break; await new Promise((resolve) => setTimeout(resolve,1000)) }
      }
      throw new DevelopmentPreviewError('health_timeout','Application did not become ready before the startup deadline')
    },
    async logs(input,handle) {
      const secrets = runSecrets.get(input.runId)
      if (!secrets) return exec(input,compose(input,handle) + ' ps --format json',undefined,[],10000)
      return redactPreviewLog(await exec(input,compose(input,handle) + ' logs --no-color --tail 100',undefined,secrets,10000),secrets)
    },
    async stop(input,handle) {
      let revokeError: unknown
      if (handle.grantId) try {
        const engine = await deps.engine(input,handle.runnerId ?? undefined)
        if (!engine) throw Error('runner_unavailable')
        const result = await fetch(engine.baseUrl + PREVIEW_CLI_GRANTS_PATH + '/' + encodeURIComponent(handle.grantId), {method:'DELETE',headers:{authorization:'Bearer ' + engine.token},signal:AbortSignal.timeout(10000)})
        if (!result.ok) throw Error('grant_revoke_failed')
        handle.grantId = null
      } catch (error) { revokeError = error }
      await deps.closeBrowser?.(input)
      if (handle.resourcesCreated) {
      await exec(input,'if test -f ' + quote(root(input,handle) + '/compose.json') + '; then ' + compose(input,handle) + ' down --volumes --remove-orphans; fi',undefined,[],30000)
      await exec(input,'node -e ' + quote("require('node:fs').rmSync(process.argv[1],{recursive:true,force:true})") + ' ' + quote(root(input,handle)),undefined,[],10000)
      handle.resourcesCreated = false
      runSecrets.delete(input.runId)
      }
      if (revokeError) throw new DevelopmentPreviewError('cleanup_failed','Scoped token revocation pending; TTL remains enforced by Runner')
    }
  }
}
