// Экспорт остаётся исполняемым с многострочным вводом; все секреты проверяются до навигации.
import type { WebRecorderScenarioStep } from '@shared/webRecorder'
const quote = (value: string): string => JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

export function scenarioToPlaywright(pageUrl: string, steps: readonly WebRecorderScenarioStep[]): string {
  const lines = ["import { test } from '@playwright/test'", '', "test('recorded web reader scenario', async ({ page }) => {"]
  let secretIndex = 0
  for (const step of steps) {
    if (step.kind !== 'type' || !step.sensitive) continue
    secretIndex++
    lines.push(`  const secret${secretIndex} = process.env.SCENARIO_SECRET_${secretIndex}`)
    lines.push(`  if (!secret${secretIndex}) throw new Error('Задайте SCENARIO_SECRET_${secretIndex} перед запуском сценария')`)
  }
  lines.push(`  await page.goto(${quote(pageUrl)})`)
  secretIndex = 0
  for (const step of steps) {
    if (step.kind === 'click') lines.push(`  await page.click(${quote(step.selector)})`)
    else {
      lines.push(`  await page.fill(${quote(step.selector)}, ${step.sensitive ? 'secret' + ++secretIndex : quote(step.text)})`)
      if (step.submit) lines.push(`  await page.press(${quote(step.selector)}, 'Enter')`)
    }
  }
  lines.push('})', '')
  return lines.join('\n')
}
