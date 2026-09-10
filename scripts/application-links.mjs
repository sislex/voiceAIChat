// Проверяет реальные связи контейнеров после замены. Собственный /health не
// обнаруживает неверный token, CORE_URL или оставшийся embedded-режим ядра.
import { applicationRuntimeMatches } from '../packages/shared/src/applicationRelease.ts'
const contracts = {
  'web-reader': {
    core: { path: '/internal/reader/core', body: { method: 'context', args: [{ userId: '__release_probe__', conversationId: '__release_probe__' }] } },
    'playwright-reader': { path: '/internal/playwright-reader/service', body: { method: 'control', args: ['__release_probe__', '__release_probe__', {type: 'status'}] } }
  },
  make: {
    core: {
      path: '/internal/make/core',
      body: {
        method: 'conversation',
        args: ['__release_probe__', '__release_probe__']
      }
    }
  },
  'image-studio': {
    core: {
      path: '/internal/image-studio/core',
      body: {
        method: 'conversation',
        args: ['__release_probe__', '__release_probe__']
      }
    }
  },
  'playwright-reader': {
    core: {
      path: '/internal/playwright-reader/core',
      body: {
        method: 'conversation',
        args: ['__release_probe__', '__release_probe__']
      }
    },
    'browser-runner': {}
  }
}
const urlEnv = {
  core: 'VC_CORE_URL',
  'playwright-reader': 'VC_PLAYWRIGHT_READER_URL',
  'browser-runner': 'VC_BROWSER_RUNNER_URL',
  'llm-runner': 'VC_LLM_RUNNER_URL'
}
const tokenEnv = {
  core: 'VC_INTERNAL_TOKEN',
  'playwright-reader': 'VC_INTERNAL_TOKEN',
  'browser-runner': 'VC_BROWSER_RUNNER_TOKEN',
  'llm-runner': 'VC_LLM_RUNNER_TOKEN'
}
export function applicationLinkChecks(environment) {
  const installed = new Map(
      environment.applications.map((item) => [
        item.manifest.applicationId,
        item.manifest
      ])
    ),
    checks = []
  for (const [id, manifest] of installed)
    for (const requirement of manifest.requires) {
      const dependency = installed.get(requirement.applicationId),
        contract = contracts[id]?.[requirement.applicationId]
      if (!dependency || !contract) continue
      for (const artifact of manifest.artifacts)
        checks.push({
          service: artifact.service,
          urlEnv: urlEnv[dependency.applicationId],
          tokenEnv: tokenEnv[dependency.applicationId],
          dependency,
          healthPath:
            dependency.applicationId === 'core' ? '/api/health' : '/v1/health',
          contract
        })
    }
  // Оркестратор должен обращаться к обновляемому сервису; иначе «успешный»
  // deploy не изменит пользовательский путь, который остался embedded.
  const core = installed.get('core')
  if (core)
    for (const id of ['make', 'image-studio', 'playwright-reader', 'web-reader']) {
      const dependency = installed.get(id)
      if (dependency)
        checks.push({
          service: core.artifacts[0].service,
          urlEnv: `VC_${(id === 'web-reader' ? 'reader' : id).toUpperCase().replaceAll('-', '_')}_URL`,
          modeEnv: `VC_${(id === 'web-reader' ? 'reader' : id).toUpperCase().replaceAll('-', '_')}_MODE`,
          dependency,
          healthPath: '/v1/health'
        })
    }
  if (core)
    for (const [id, dependency] of installed)
      if (id.endsWith('-ui'))
        checks.push({
          service: core.artifacts[0].service,
          mapEnv: 'VC_APPLICATION_FRONTENDS',
          mapKey: id,
          gatewayPath: `/applications/${id}/manifest.json`,
          dependency,
          healthPath: '/v1/health'
        })
  return checks
}
export function applicationLinksHealthy(environment, inventory, execute) {
  try {
    for (const check of applicationLinkChecks(environment)) {
      const containers = inventory.filter(
        (item) =>
          item.Config.Labels?.['com.docker.compose.service'] === check.service
      )
      if (containers.length !== 1 || !containers[0].State.Running) return false
      const source = `const check=${JSON.stringify(check)};let base=check.mapEnv?JSON.parse(process.env[check.mapEnv]??'{}')[check.mapKey]:process.env[check.urlEnv];if(!base||(check.modeEnv&&process.env[check.modeEnv]!=='remote'))process.exit(2);const url=new URL(base);if(!['http:','https:'].includes(url.protocol))process.exit(2);const headers=check.tokenEnv?{authorization:'Bearer '+process.env[check.tokenEnv]}:{};const response=await fetch(base.replace(/\\/$/,'')+check.healthPath,{headers,signal:AbortSignal.timeout(8000)});if(!response.ok)process.exit(2);const body=await response.json();if(check.contract?.path){const rpc=await fetch(base.replace(/\\/$/,'')+check.contract.path,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(check.contract.body),signal:AbortSignal.timeout(8000)});const reply=await rpc.json();if(!rpc.ok||!Object.hasOwn(reply,'result')||reply.result!==null)process.exit(2);}if(check.gatewayPath){const gateway=await fetch('http://127.0.0.1:'+(process.env.PORT??8787)+check.gatewayPath,{signal:AbortSignal.timeout(8000)});const artifact=await gateway.json();if(!gateway.ok||artifact.applicationId!==check.dependency.applicationId||artifact.version!==check.dependency.version||artifact.commit!==check.dependency.commit)process.exit(2);}console.log(JSON.stringify(body.application));`
      const actual = JSON.parse(
        execute([
          'exec',
          containers[0].Id,
          'node',
          '--input-type=module',
          '-e',
          source
        ])
      )
      if (!applicationRuntimeMatches(check.dependency, actual)) return false
    }
    return true
  } catch {
    return false
  }
}
