/** Real-browser coverage, called while verify:page has the shell and containers running. */
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'

const shots = fileURLToPath(new URL('../../screenshots/', import.meta.url))

export async function verifyUserContextDevtools(browser) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  await mkdir(shots, { recursive: true })
  const screenshot = name =>
    page.screenshot({ path: `${shots}${name}.png`, animations: 'disabled' })
  const panel = page.locator('[data-mfe-devtools-panel]')
  const selectOwner = async () => {
    const picker = page.getByLabel('Choose user-context owner', { exact: true })
    if (await picker.isVisible()) {
      await picker.click()
      await page.getByLabel('Find a user-context owner', { exact: true }).fill('lab')
      await page.getByRole('option', { name: 'lab', exact: true }).click()
      await expect(page.locator('[data-slot="combobox-content"]')).toHaveCount(0)
    } else {
      await page.getByRole('button', { name: 'Inspect lab', exact: true }).click()
    }
  }
  const open = async () => {
    await page.getByRole('button', { name: 'Open the developer tools', exact: true }).click()
    await page.getByRole('tab', { name: 'User Context', exact: true }).click()
    await selectOwner()
  }
  const close = () => page.getByRole('button', { name: 'Close the developer tools' }).click()
  let heldWrite
  try {
    await page.goto('http://localhost:3000/lab/user-context?devtools=1', { waitUntil: 'load' })
    await close()
    const survey = page.getByRole('region', { name: 'React survey app', exact: true })
    await survey.getByLabel('Well', { exact: true }).selectOption('well-42')
    await open()
    await expect(page.getByLabel('value of lab', { exact: true })).toContainText('well-42')
    await expect(panel.getByRole('button', { name: 'Inspect lab', exact: true })).toContainText(
      'Ready',
    )
    await screenshot('user-context-value')
    await page.getByRole('tab', { name: 'Keys', exact: true }).click()
    await expect(page.getByRole('button', { name: 'lab:units', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'lab:well-selection', exact: true }).click()
    const nestedValue = page.getByLabel('value of lab:well-selection', { exact: true })
    await expect(nestedValue).toBeVisible()
    await expect(nestedValue).toContainText('well-42')
    await expect.poll(async () => (await nestedValue.boundingBox())?.height ?? 0).toBeGreaterThan(0)
    await screenshot('user-context-keys')
    await page.getByRole('tab', { name: 'Value', exact: true }).click()

    // Hold persistence: consumers and the inspector keep the stored value until the server answers.
    const pendingWrite = new Promise(resolve => {
      heldWrite = resolve
    })
    await page.route('**/api/user-context/write/lab', route => {
      heldWrite(route)
    })
    await close()
    await survey.getByLabel('Well', { exact: true }).selectOption('well-17')
    const route = await pendingWrite
    await open()
    await expect(page.getByLabel('value of lab', { exact: true })).toContainText('well-42')
    await expect(survey.getByLabel('Well', { exact: true })).toHaveValue('well-42')
    await route.continue()
    await page.unroute('**/api/user-context/write/lab')
    await expect(survey.getByLabel('Well', { exact: true })).toHaveValue('well-17')
    await expect(page.getByLabel('value of lab', { exact: true })).toContainText('well-17')
    await screenshot('user-context-saved')

    await page.getByRole('tab', { name: 'Schema', exact: true }).click()
    await expect(page.getByLabel('schema for lab', { exact: true })).toContainText('comparisonMode')
    await screenshot('user-context-schema')
    await page.getByLabel('Search user-context owners', { exact: true }).fill('no-such-owner')
    await expect(page.getByText('No owners match your search')).toBeVisible()
    await page.getByLabel('Search user-context owners', { exact: true }).fill('')
    await selectOwner()

    // Responsive layout and tab persistence, using the panel's own controls.
    await page.getByRole('button', { name: 'Dock to the right', exact: true }).click()
    await expect(panel).toHaveAttribute('data-side', 'right')
    await screenshot('user-context-side-dock')
    await page.reload()
    await expect(page.getByRole('tab', { name: 'User Context', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await page.setViewportSize({ width: 390, height: 844 })
    await selectOwner()
    await expect(page.getByRole('tab', { name: 'Value', exact: true })).toBeVisible()
    await screenshot('user-context-mobile')
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    console.log(
      'User Context devtools: namespaced keys, nested values, held persistence, schema, search, docking and mobile verified.',
    )
  } finally {
    await page.close()
  }
}
