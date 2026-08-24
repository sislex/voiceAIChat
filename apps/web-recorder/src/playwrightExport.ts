// Экспорт записанного сценария Web Reader в Playwright-тест. Чистая функция:
// секретные значения не встраиваются — вместо них переменные окружения.

import type { WebRecorderScenarioStep } from '@shared/webRecorder'

const quote = (value: string): string => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

export function scenarioToPlaywright(pageUrl: string, steps: readonly WebRecorderScenarioStep[]): string {
  const lines: string[] = [
    "import { test } from '@playwright/test'",
    '',
    "test('recorded web reader scenario', async ({ page }) => {",
    `  await page.goto(${quote(pageUrl)})`
  ]
  let secretIndex = 0
  for (const step of steps) {
    if (step.kind === 'click') {
      lines.push(`  await page.click(${quote(step.selector)})`)
      continue
    }
    if (step.sensitive) {
      secretIndex += 1
      lines.push(`  // Секретное значение не записано — задайте переменную окружения перед запуском.`)
      lines.push(`  await page.fill(${quote(step.selector)}, process.env.SCENARIO_SECRET_${secretIndex} ?? '')`)
    } else {
      lines.push(`  await page.fill(${quote(step.selector)}, ${quote(step.text)})`)
    }
    if (step.submit) lines.push(`  await page.press(${quote(step.selector)}, 'Enter')`)
  }
  lines.push('})', '')
  return lines.join('\n')
}
