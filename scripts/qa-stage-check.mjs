#!/usr/bin/env tsx
// Сквозная проверка серверного пути этапа Automated QA.
//
// Всё, что проверялось до круга 22, било либо в раннер напрямую
// (`reader:probe`), либо в исполнитель шага с моками. Сам путь этапа —
// `createAutomatedQaScenarioRunner` поверх настоящего `BrowserRunnerClient` —
// живьём не запускался ни разу: его знали только тесты с подставными объектами.
// Это код, который работает на проде, и проверять его надо в тех же условиях.
//
// Запуск: npm run qa-stage:check -- <файл-со-сценариями>
// Требует поднятого локального раннера (npm run browser-runner:local).

import { mkdtempSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBrowserRunnerClient } from '../apps/server/src/browser/runnerClient.js'
import { createAutomatedQaScenarioRunner } from '../apps/server/src/ci/automatedQaScenario.js'
import { parseAutomatedQaScenarios, scenarioLabel } from '../packages/shared/src/qa.js'
import { readFileSync } from 'node:fs'

const file = process.argv[2]
if (!file) {
  console.error('нужен файл со сценариями: npm run qa-stage:check -- suite.json')
  process.exit(2)
}

const baseUrl = process.env.VC_BROWSER_RUNNER_URL ?? 'http://localhost:8892'
const token = process.env.VC_BROWSER_RUNNER_TOKEN ?? 'vc-local-reader'
const scenarios = parseAutomatedQaScenarios(JSON.parse(readFileSync(file, 'utf8')))
if (!scenarios.length) {
  console.error('в файле нет ни одного сценария')
  process.exit(2)
}

const screenshotDir = mkdtempSync(join(tmpdir(), 'qa-stage-'))
const runner = createAutomatedQaScenarioRunner({
  browser: createBrowserRunnerClient({ baseUrl, token }),
  screenshotDir,
  screenshotUrl: (runId) => `/api/qa/runs/${runId}/screenshot`
})

let failed = false
for (const [index, scenario] of scenarios.entries()) {
  const label = scenarioLabel(scenario, index)
  const runId = `check-${process.pid}-${index}`
  const outcome = await runner.run({
    runId,
    userId: 'qa-stage-check',
    scenario,
    signal: new AbortController().signal,
    budgetMs: 60_000,
    onStep: (step, at, total) => {
      console.log(`  ${at + 1}/${total} ${step.title}: ${step.status}${step.detail ? ` — ${step.detail}` : ''}`)
      // Ошибки шага, а не всего прогона (круг 28): по ним видно, какое именно
      // действие сломало страницу.
      for (const error of step.pageErrors ?? []) console.log(`      ошибка страницы: ${error}`)
    }
  })
  const shot = join(screenshotDir, `${runId}.png`)
  const size = existsSync(shot) ? statSync(shot).size : 0
  console.log(`${label}: ${outcome.blocked ? `ЗАБЛОКИРОВАН — ${outcome.blocked}` : outcome.steps.every((s) => s.status === 'passed') ? 'пройден' : 'ПРОВАЛЕН'}`)
  console.log(`  снимок: ${size ? `${size} байт` : 'НЕТ'}${outcome.screenshotError ? ` (ошибка: ${outcome.screenshotError})` : ''}`)
  // Ошибки страницы этап собирает с круга 27: провалом они не считаются, но в
  // вердикт уходят — обычно они и есть ответ на «почему шаг не прошёл».
  console.log(`  ошибки страницы: ${outcome.pageErrors.length ? outcome.pageErrors.join(' ; ') : 'нет'}`)
  if (outcome.blocked || outcome.steps.some((s) => s.status === 'failed')) { failed = true; break }
}

process.exit(failed ? 1 : 0)
