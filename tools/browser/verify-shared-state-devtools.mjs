/** Real-browser coverage, called while verify:page has the shell and containers running. */
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'

const shots = fileURLToPath(new URL('../../screenshots/', import.meta.url))

export async function verifySharedStateDevtools(browser) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  await mkdir(shots, { recursive: true })
  const screenshot = name => page.screenshot({ path: `${shots}${name}.png` })
  const panel = page.locator('[data-mfe-devtools-panel]')
  const selectWell = async () => {
    const picker = page.getByLabel('Choose shared-state key', { exact: true })
    if (await picker.isVisible()) {
      await picker.click()
      await page.getByLabel('Find a shared-state key', { exact: true }).fill('well:selection')
      await page.getByRole('option', { name: 'well:selection', exact: true }).click()
    } else {
      await page.getByRole('button', { name: 'Inspect well:selection', exact: true }).click()
    }
  }
  const open = async () => {
    await page.getByRole('button', { name: 'Open the developer tools', exact: true }).click()
    await page.getByRole('tab', { name: 'Shared State', exact: true }).click()
    await selectWell()
  }
  const close = () => page.getByRole('button', { name: 'Close the developer tools' }).click()
  let heldWrite
  try {
    await page.goto('http://localhost:3000/lab/shared-state?devtools=1', { waitUntil: 'load' })
    await close()
    const survey = page.getByRole('region', { name: 'React survey app', exact: true })
    await survey.getByLabel('Well', { exact: true }).selectOption('well-42')
    await open()
    await expect(page.getByLabel('current value of well:selection', { exact: true })).toContainText(
      'well-42',
    )
    await expect(panel.getByText('Ready', { exact: true })).toHaveCount(3)
    await screenshot('shared-state-current')

    // Hold the persistence response to verify the two values against a real consumer write.
    const pendingWrite = new Promise(resolve => {
      heldWrite = resolve
    })
    await page.route('**/api/shared-state/write', route => {
      heldWrite(route)
    })
    await close()
    await survey.getByLabel('Well', { exact: true }).selectOption('well-17')
    const route = await pendingWrite
    await open()
    await expect(page.getByLabel('current value of well:selection', { exact: true })).toContainText(
      'well-17',
    )
    await expect(panel.getByText('Pending', { exact: true })).toHaveCount(2)
    await screenshot('shared-state-pending')
    await page.getByRole('tab', { name: 'Confirmed', exact: true }).click()
    await expect(
      page.getByLabel('confirmed value of well:selection', { exact: true }),
    ).toContainText('well-42')
    await screenshot('shared-state-confirmed')
    await route.continue()
    await page.unroute('**/api/shared-state/write')
    await expect(panel.getByText('Pending', { exact: true })).toHaveCount(0)
    await expect(
      page.getByLabel('confirmed value of well:selection', { exact: true }),
    ).toContainText('well-17')

    await page.getByRole('tab', { name: 'Contract', exact: true }).click()
    await expect(page.getByLabel('contract for well:selection', { exact: true })).toContainText(
      'comparisonMode',
    )
    await screenshot('shared-state-contract')
    await page.getByLabel('Search shared-state contracts', { exact: true }).fill('no-such-contract')
    await expect(page.getByText('No contracts match your search')).toBeVisible()
    await page.getByLabel('Search shared-state contracts', { exact: true }).fill('')
    await selectWell()

    // Responsive layout and tab persistence, using the panel's own controls.
    await page.getByRole('button', { name: 'Dock to the right', exact: true }).click()
    await expect(panel).toHaveAttribute('data-side', 'right')
    await screenshot('shared-state-side-dock')
    await page.reload()
    await expect(page.getByRole('tab', { name: 'Shared State', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await page.setViewportSize({ width: 390, height: 844 })
    await selectWell()
    await expect(page.getByRole('tab', { name: 'Current value', exact: true })).toBeVisible()
    await screenshot('shared-state-mobile')
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    console.log(
      'Shared State devtools: live values, pending persistence, confirmed values, schema, search, docking and mobile verified.',
    )
  } finally {
    await page.close()
  }
}
