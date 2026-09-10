// Подготовка и deploy приложения не используют legacy-команду общего релиза.
// Все версии/артефакты после подготовки неизменяемы; рестарт только сверяет
// фактическое состояние и не повторяет потенциально завершившуюся замену.
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import {
  applicationReleaseBranch,
  parseApplicationReleaseManifest,
  parseApplicationEnvironment,
  validateCatalogRelease,
  type ApplicationReleaseInput,
  type ApplicationReleaseManifest,
  type ApplicationDeployInput,
  type ApplicationDeploymentRecord,
  type ApplicationEnvironment,
  type ApplicationEnvironmentName
} from '@voicechat/shared'
import type { VoiceChatDb } from '../db/database.js'
import {
  releaseCheckoutCommand,
  type ReleaseProjectTarget,
  type ReleaseRuntime
} from './releaseManager.js'
import { shellQuote } from '../ci/executor.js'
export interface ApplicationDeployTarget extends ReleaseProjectTarget {
  configPath: string
}
export function applicationTargetFingerprint(
  target: ApplicationDeployTarget
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        target.projectId,
        target.agentId,
        target.path,
        target.gitUrl,
        target.configPath
      ])
    )
    .digest('hex')
}
export interface ApplicationReleaseRuntime {
  prepare(
    target: ReleaseProjectTarget,
    input: ApplicationReleaseInput,
    id: string
  ): Promise<{ manifest: ApplicationReleaseManifest; log: string }>
  execute(
    target: ApplicationDeployTarget,
    request: Record<string, unknown>
  ): Promise<{
    environment: ApplicationEnvironment | null
    status?: 'released' | 'failed' | 'uncertain'
    log?: string
  }>
}
export function validateApplicationReleaseInput(
  value: ApplicationReleaseInput
): ApplicationReleaseInput {
  if (
    !value ||
    typeof value.image !== 'string' ||
    value.image.length > 400 ||
    !/^[a-z0-9][a-z0-9._:/-]*$/.test(value.image) ||
    typeof value.baseBranch !== 'string' ||
    value.baseBranch.length > 200 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9/_-]*(?:\.[a-zA-Z0-9/_-]+)*$/.test(
      value.baseBranch
    ) ||
    value.baseBranch.includes('..') ||
    value.baseBranch.endsWith('/') ||
    value.baseBranch.endsWith('.lock')
  )
    throw new Error('Неверное имя образа или базовой ветки')
  const branch = applicationReleaseBranch(value.applicationId, value.version)
  const appId = branch.split('/')[1]
  // Сервисы всегда берутся из каталога; клиент не может назначить чужой контейнер.
  const app = APPLICATION_CATALOG.find((app) => app.id === appId)
  const manifest = parseApplicationReleaseManifest({
    schemaVersion: 1,
    applicationId: appId,
    version: value.version,
    apiVersion: '1.0.0',
    commit: '0'.repeat(40),
    artifacts: (app?.services ?? []).map((service) => ({
      kind: 'oci',
      service,
      reference: 'validation@sha256:' + '0'.repeat(64)
    })),
    requires: value.requires,
    capabilities: [],
    dataVersion: '1.0.0'
  })
  validateCatalogRelease(manifest)
  return {
    applicationId: appId,
    version: manifest.version,
    image: value.image,
    baseBranch: value.baseBranch,
    requires: manifest.requires
  }
}
import { APPLICATION_CATALOG } from '@voicechat/shared'
export function applicationPrepareCommand(
  target: ReleaseProjectTarget,
  raw: ApplicationReleaseInput,
  id: string
): string {
  const input = validateApplicationReleaseInput(raw),
    branch = applicationReleaseBranch(input.applicationId, input.version)
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(id))
    throw new Error('Неверный id подготовки')
  const ref = `refs/voicechat/application-preparation/${id}`
  const requirements = Buffer.from(JSON.stringify(input.requires)).toString(
    'base64'
  )
  const lines = [
    'set -eu',
    ...(target.prepareCheckout ? [releaseCheckoutCommand(target)] : []),
    `cd ${shellQuote(target.path)}`,
    `test "$(git config --get remote.origin.url)" = ${shellQuote(target.gitUrl)}`,
    `git check-ref-format --branch ${shellQuote(input.baseBranch)} >/dev/null`,
    'application_tmp=$(mktemp -d)',
    `cleanup(){ git -C ${shellQuote(target.path)} worktree remove --force "$application_tmp/source" >/dev/null 2>&1 || true; git -C ${shellQuote(target.path)} update-ref -d ${shellQuote(ref)}; rm -rf "$application_tmp"; }`,
    'trap cleanup EXIT',
    `git fetch origin ${shellQuote(`+refs/heads/${input.baseBranch}:${ref}`)}`,
    `application_sha=$(git rev-parse ${shellQuote(ref)})`,
    'git worktree add --detach "$application_tmp/source" "$application_sha"',
    'cd "$application_tmp/source"',
    `node -e ${shellQuote(`require('node:fs').writeFileSync(process.argv[1],Buffer.from('${requirements}','base64'))`)} "$application_tmp/requires.json"`,
    'npm ci --no-audit --no-fund',
    `npm run gate:app -- ${shellQuote(input.applicationId)}`,
    `node --import tsx scripts/application-build.mjs ${shellQuote(input.applicationId)} --version ${shellQuote(input.version)} --image ${shellQuote(input.image)} --requires "$application_tmp/requires.json" --push --output "$application_tmp/release.json"`,
    // Матрица проверяет опубликованный digest, не другой образ с тем же тегом.
    `node --import tsx scripts/application-compatibility.mjs --manifest "$application_tmp/release.json"`,
    'test "$(git rev-parse HEAD)" = "$application_sha"',
    `git push --force-with-lease=refs/heads/${branch}: origin "HEAD:refs/heads/${branch}"`,
    `node -e ${shellQuote(`console.log('VOICECHAT_APPLICATION_RESULT='+require('node:fs').readFileSync(process.argv[1],'utf8').trim())`)} "$application_tmp/release.json"`
  ]
  return lines.join('\n')
}
export function createApplicationReleaseRuntime(
  runtime: Pick<ReleaseRuntime, 'exec'>
): ApplicationReleaseRuntime {
  return {
    async prepare(target, input, id) {
      const result = await runtime.exec(
        target,
        applicationPrepareCommand(target, input, id),
        target.limits?.regressionMs ?? 1_800_000
      )
      if (result.exitCode !== 0 || result.timedOut)
        throw new Error(
          result.output.slice(-100_000) || 'Подготовка приложения прервана'
        )
      const marker = result.output.lastIndexOf('VOICECHAT_APPLICATION_RESULT=')
      if (marker < 0)
        throw new Error('Подготовка не вернула проверенный манифест')
      return {
        manifest: parseApplicationReleaseManifest(
          JSON.parse(
            result.output.slice(marker + 'VOICECHAT_APPLICATION_RESULT='.length)
          )
        ),
        log: result.output.slice(0, marker)
      }
    },
    async execute(target, request) {
      const encoded = Buffer.from(JSON.stringify(request)).toString('base64url')
      const command = `cd ${shellQuote(target.path)} && node --import tsx scripts/application-deploy.mjs --config ${shellQuote(target.configPath)} --request ${shellQuote(encoded)}`
      const result = await runtime.exec(target, command, 600_000)
      if (result.exitCode !== 0 || result.timedOut)
        throw new Error(
          result.output.slice(-100_000) || 'Нет результата deploy приложения'
        )
      const response = JSON.parse(result.output.trim()) as {
        environment: unknown
        status?: 'released' | 'failed' | 'uncertain'
        log?: string
      }
      if (
        response.status !== undefined &&
        !['released', 'failed', 'uncertain'].includes(response.status)
      )
        throw new Error('Некорректный статус исполнителя deploy')
      return {
        ...response,
        environment: response.environment
          ? parseApplicationEnvironment(response.environment)
          : null
      }
    }
  }
}
export class ApplicationReleaseManager {
  private readonly active = new Set<string>()
  constructor(
    private readonly db: VoiceChatDb,
    private readonly runtime: ApplicationReleaseRuntime
  ) {}
  async prepare(
    userId: string,
    target: ReleaseProjectTarget,
    raw: ApplicationReleaseInput
  ) {
    const input = validateApplicationReleaseInput(raw)
    const { record, created } = await this.db.releases.createApplicationRelease(
      userId,
      target.projectId,
      input
    )
    if (created) {
      this.active.add(record.id)
      void (async () => {
        try {
          const result = await this.runtime.prepare(target, input, record.id)
          await this.db.releases.finishApplicationRelease(
            record.id,
            result.manifest,
            result.log
          )
        } catch (error) {
          await this.db.releases.finishApplicationRelease(
            record.id,
            null,
            error instanceof Error ? error.message : String(error)
          )
        } finally {
          this.active.delete(record.id)
        }
      })().catch((error) =>
        console.error(
          '[application-release] не удалось сохранить итог подготовки',
          error
        )
      )
    }
    return record
  }
  async observe(
    userId: string,
    target: ApplicationDeployTarget,
    environment: ApplicationEnvironmentName,
    expectedRevision: number
  ) {
    const overview = await this.db.releases.applicationReleaseOverview(
      userId,
      target.projectId,
      environment
    )
    if (overview.activeDeploymentId)
      throw new Error('Сначала завершите сверку активного deploy')
    const result = await this.runtime.execute(target, {
      mode: 'observe',
      projectId: target.projectId,
      environment,
      previous: overview.environment
    })
    if (!result.environment)
      throw new Error('Нет фактического состава окружения')
    await this.db.releases.observeApplicationEnvironment(
      userId,
      target.projectId,
      environment,
      result.environment,
      expectedRevision
    )
    return this.db.releases.applicationReleaseOverview(
      userId,
      target.projectId,
      environment
    )
  }
  async deploy(
    userId: string,
    target: ApplicationDeployTarget,
    environment: ApplicationEnvironmentName,
    input: ApplicationDeployInput
  ) {
    const { record, created } =
      await this.db.releases.beginApplicationDeployment(
        userId,
        target.projectId,
        environment,
        input,
        applicationTargetFingerprint(target)
      )
    if (created) {
      this.active.add(record.id)
      void this.execute(record, target, 'deploy')
        .finally(() => this.active.delete(record.id))
        .catch((error) =>
          console.error(
            '[application-release] не удалось сохранить итог deploy',
            error
          )
        )
    }
    return record
  }
  private async execute(
    record: ApplicationDeploymentRecord,
    target: ApplicationDeployTarget,
    mode: 'deploy' | 'reconcile'
  ) {
    try {
      if (record.targetFingerprint !== applicationTargetFingerprint(target))
        throw new Error(
          'Площадка deploy изменилась; восстановите исходную машину и конфигурацию перед сверкой'
        )
      const result = await this.runtime.execute(target, {
        mode,
        id: record.id,
        projectId: record.projectId,
        environment: record.environment,
        previous: record.previous,
        releases: record.releases
      })
      if (!result.status) throw new Error('Исполнитель не вернул статус deploy')
      await this.db.releases.finishApplicationDeployment(
        record.id,
        result.status,
        result.environment,
        result.log ?? ''
      )
    } catch (error) {
      await this.db.releases.finishApplicationDeployment(
        record.id,
        'uncertain',
        null,
        error instanceof Error ? error.message : String(error)
      )
    }
  }
  async reconcile(
    resolve: (
      record: ApplicationDeploymentRecord
    ) => Promise<ApplicationDeployTarget | null>
  ) {
    const interrupted =
      await this.db.releases.interruptedApplicationOperations()
    for (const release of interrupted.releases)
      if (!this.active.has(release.id))
        await this.db.releases.finishApplicationRelease(
          release.id,
          null,
          'Подготовка прервана рестартом; непроверенный артефакт не допускается к deploy.'
        )
    for (const record of interrupted.deployments)
      if (!this.active.has(record.id)) {
        this.active.add(record.id)
        try {
          const target = await resolve(record)
          if (target) await this.execute(record, target, 'reconcile')
        } catch (error) {
          await this.db.releases.finishApplicationDeployment(
            record.id,
            'uncertain',
            null,
            error instanceof Error ? error.message : String(error)
          )
        } finally {
          this.active.delete(record.id)
        }
      }
  }
  async reconcileOne(
    userId: string,
    target: ApplicationDeployTarget,
    environment: ApplicationEnvironmentName
  ) {
    const overview = await this.db.releases.applicationReleaseOverview(
      userId,
      target.projectId,
      environment
    )
    const record = overview.deployments.find(
      (record) => record.id === overview.activeDeploymentId
    )
    if (record && !this.active.has(record.id)) {
      this.active.add(record.id)
      try {
        await this.execute(record, target, 'reconcile')
      } finally {
        this.active.delete(record.id)
      }
    }
    return this.db.releases.applicationReleaseOverview(
      userId,
      target.projectId,
      environment
    )
  }
}
export function applicationDeployConfigPath(
  target: ReleaseProjectTarget & { managedRoot?: string },
  environment: ApplicationEnvironmentName
): string {
  return target.managedRoot
    ? join(target.managedRoot, 'config', 'applications.json')
    : join(dirname(target.path), `applications.${environment}.json`)
}
