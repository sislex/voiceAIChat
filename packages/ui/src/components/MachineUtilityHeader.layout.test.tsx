import { it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { MachineUtilityHeader } from './MachineUtilityHeader'
import { makeAgent } from '../test/fixtures/machines'

// @testCase T9
it('keeps name and status on one row and every segment within 390px in Chromium', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    const html = renderToStaticMarkup(<MachineUtilityHeader agents={[makeAgent({ id: 'mobile', name: 'Very long machine name that must remain usable on a phone' })]} agentId="mobile" onAgentChange={() => {}} kind="explorer" onSwitch={() => {}} />)
    await page.setContent('<html lang="en"><body style="margin:0">' + html + '</body></html>')
    await page.addStyleTag({ content: readFileSync(new URL('../styles/app.css', import.meta.url), 'utf8') })
    const name = await page.locator('.uhead-name').boundingBox()
    const status = await page.locator('.uhead-status').boundingBox()
    expect(name).not.toBeNull()
    expect(status).not.toBeNull()
    expect(Math.abs((name!.y + name!.height / 2) - (status!.y + status!.height / 2))).toBeLessThan(2)
    expect(name!.x + name!.width).toBeLessThanOrEqual(status!.x)
    for (const button of await page.locator('.uhead-switch button').all()) {
      const box = await button.boundingBox()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(390)
    }
  } finally { await browser.close() }
})
