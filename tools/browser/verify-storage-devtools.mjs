/** Real-browser coverage, called while verify:page has the shell and containers running. */
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'

const shots = fileURLToPath(new URL('../../screenshots/', import.meta.url))
const ID = 'lab › well-selection'
const SAVE = '**/api/user-storage/lab/well-selection'

export async function verifyStorageDevtools(browser) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  await mkdir(shots, { recursive: true })
  const screenshot = name => page.screenshot({ path: `${shots}${name}.png` })
  const panel = page.locator('[data-mfe-devtools-panel]')
  const selectWell = async () => {
    const picker = page.getByLabel('Choose stored key', { exact: true })
    if (await picker.isVisible()) {
      await picker.click()
      await page.getByLabel('Find a stored key', { exact: true }).fill('well-selection')
      await page.getByRole('option', { name: ID, exact: true }).click()
      await expect(page.locator('[data-slot="combobox-content"]')).toHaveCount(0)
    } else {
      await page.getByRole('button', { name: `Inspect ${ID}`, exact: true }).click()
    }
  }
  const open = async () => {
    await page.getByRole('button', { name: 'Open the developer tools', exact: true }).click()
    await page.getByRole('tab', { name: 'Storage', exact: true }).click()
    await selectWell()
  }
  const close = () => page.getByRole('button', { name: 'Close the developer tools' }).click()
  let heldSave
  try {
    await page.goto('http://localhost:3000/lab/user-storage?devtools=1', { waitUntil: 'load' })
    await close()
    const survey = page.getByRole('region', { name: 'React survey app', exact: true })
    await survey.getByLabel('Well', { exact: true }).selectOption('well-42')
    await open()
    await expect(page.getByLabel(`stored data of ${ID}`, { exact: true })).toContainText('well-42')
    await expect(panel.getByText('Loaded', { exact: true })).toBeVisible()
    await screenshot('storage-current')

    // Hold the backend's answer to see the value being saved beside the one the server confirmed.
    const pendingSave = new Promise(resolve => {
      heldSave = resolve
    })
    await page.route(SAVE, route => {
      heldSave(route)
    })
    await close()
    await survey.getByLabel('Well', { exact: true }).selectOption('well-17')
    const route = await pendingSave
    await open()
    await expect(page.getByLabel(`value being saved for ${ID}`, { exact: true })).toContainText(
      'well-17',
    )
    await expect(page.getByLabel(`stored data of ${ID}`, { exact: true })).toContainText('well-42')
    await expect(panel.getByText('Saving', { exact: true }).first()).toBeVisible()
    await screenshot('storage-saving')
    await route.continue()
    await page.unroute(SAVE)
    await expect(page.getByLabel(`value being saved for ${ID}`, { exact: true })).toHaveCount(0)
    await expect(page.getByLabel(`stored data of ${ID}`, { exact: true })).toContainText('well-17')
    await screenshot('storage-saved')

    await page.getByRole('tab', { name: 'Row', exact: true }).click()
    await expect(page.getByLabel(`row of ${ID}`, { exact: true })).toContainText('revision')
    await screenshot('storage-row')
    await page.getByLabel('Search stored keys', { exact: true }).fill('no-such-key')
    await expect(page.getByText('No keys match your search')).toBeVisible()
    await page.getByLabel('Search stored keys', { exact: true }).fill('')
    await selectWell()

    // Responsive layout and tab persistence, using the panel's own controls.
    await page.getByRole('button', { name: 'Dock to the right', exact: true }).click()
    await expect(panel).toHaveAttribute('data-side', 'right')
    await screenshot('storage-side-dock')
    await page.reload()
    await expect(page.getByRole('tab', { name: 'Storage', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await page.setViewportSize({ width: 390, height: 844 })
    await selectWell()
    await expect(page.getByRole('tab', { name: 'Stored data', exact: true })).toBeVisible()
    await screenshot('storage-mobile')
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    console.log(
      'Storage devtools: stored rows, a save in flight, the confirmed row, search, docking and mobile verified.',
    )
  } finally {
    await page.close()
  }
}
