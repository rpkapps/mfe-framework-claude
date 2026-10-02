/** The dark Angular-only page and survey changes from issue #48. */
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'

export async function verifySharedStateFieldwork(browser) {
  const page = await browser.newPage({ viewport: { width: 2550, height: 1274 } })
  const shots = fileURLToPath(new URL('../../screenshots/', import.meta.url))
  await mkdir(shots, { recursive: true })
  await page.addInitScript(() => {
    localStorage.setItem('theme', 'dark')
    localStorage.setItem(
      'company:mfe:devtools',
      JSON.stringify({ on: true, open: true, tab: 'shared-state', side: 'bottom', size: 520 }),
    )
  })
  const panel = page.locator('[data-mfe-devtools-panel]')
  try {
    // Seed the same well before navigating to the Angular-only consumer.
    await page.goto('http://localhost:3000/lab/shared-state?devtools=1', { waitUntil: 'load' })
    await page.getByLabel('Well', { exact: true }).selectOption('well-42')
    await page.getByLabel('Survey run', { exact: true }).selectOption('run-7')
    await expect(panel.getByText('Pending', { exact: true })).toHaveCount(0)
    await page.goto('http://localhost:3000/fieldwork/shared-state?devtools=1', {
      waitUntil: 'load',
    })
    await panel.getByRole('button', { name: 'Inspect well:selection', exact: true }).click()
    const current = page.getByLabel('current value of well:selection', { exact: true })
    await expect(current).toContainText('well-42')
    const survey = page.getByRole('combobox', { name: 'Survey for inspection', exact: true })
    // Load PrimeNG's dropdown styles and finish font/selection transitions before measuring.
    await survey.click()
    await page.keyboard.press('Escape')
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(250)
    const live = await panel.evaluateHandle(element => {
      const tab = element.querySelector('[role="tab"][aria-label="Shared State"]')
      const value = element.querySelector('[aria-label="current value of well:selection"]')
      const description = value.parentElement.querySelector('p')
      const paint = node => {
        const style = getComputedStyle(node)
        const rect = node.getBoundingClientRect()
        return [
          node.isConnected,
          style.color,
          style.backgroundColor,
          style.opacity,
          style.visibility,
          style.display,
          style.fontFamily,
          style.fontSize,
          style.fontWeight,
          rect.x,
          rect.y,
          rect.width,
          rect.height,
        ]
      }
      const baseline = JSON.stringify([paint(tab), paint(value), paint(description)])
      const changes = new Set()
      let frame
      let samples = 0
      const sample = () => {
        samples++
        const appearance = JSON.stringify([paint(tab), paint(value), paint(description)])
        if (appearance !== baseline) changes.add(appearance)
        frame = requestAnimationFrame(sample)
      }
      sample()
      return {
        tab,
        value,
        description,
        explanation: description.textContent,
        stop: () => {
          cancelAnimationFrame(frame)
          return { samples, changes: [...changes] }
        },
      }
    })
    for (const [name, run] of [
      ['October survey', 'run-8'],
      ['Baseline survey', 'run-7'],
    ]) {
      let route
      await page.route('**/api/shared-state/write', pending => {
        route = pending
      })
      await survey.click()
      await page.getByRole('option', { name, exact: true }).click()
      await expect.poll(() => route !== undefined, { timeout: 10000 }).toBe(true)
      await expect(current).toContainText(run)
      await expect(panel.getByText('Pending', { exact: true })).toHaveCount(2)
      expect(
        await live.evaluate(
          ({ description, explanation }) => description.textContent === explanation,
        ),
      ).toBe(true)
      await panel.screenshot({ path: `${shots}shared-state-fieldwork-${run}-pending.png` })
      await route.continue()
      await page.unroute('**/api/shared-state/write')
      await expect(panel.getByText('Pending', { exact: true })).toHaveCount(0)
      await page.waitForTimeout(1500)
    }
    const result = await live.evaluate(({ stop }) => stop())
    expect(result.samples).toBeGreaterThan(30)
    expect(result.changes).toEqual([])
    await live.dispose()
    await panel.screenshot({ path: `${shots}shared-state-fieldwork-stable.png` })
    console.log(
      'Shared State Fieldwork: dark Angular survey writes preserve tab paint, layout and explanation.',
    )
  } catch (error) {
    await panel.screenshot({ path: `${shots}shared-state-fieldwork-failure.png` })
    throw error
  } finally {
    await page.close()
  }
}
