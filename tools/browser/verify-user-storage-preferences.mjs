/** Real API persistence and a deterministically delayed load, while verify:page serves the shell. */
import { expect } from '@playwright/test'

const API = 'http://localhost:3010/api/user-storage'

export async function verifyUserStoragePreferences(browser) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  // The runtime's own pre-paint cache key for the shell's local demo user, who has no tenant or
  // account.
  const cacheKey = `mfe:theme:${encodeURIComponent(JSON.stringify([null, null, 'u-2841']))}`
  const errors = []
  page.on('pageerror', error => errors.push(`pageerror: ${error.stack ?? error.message}`))
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  let releaseLoad
  const loadGate = new Promise(resolve => {
    releaseLoad = resolve
  })
  let loadStarted = false
  try {
    // Chromium treats an intercepted document as a new address space. This test explicitly
    // permits its localhost API, as a user would when granting local-network access.
    await page.context().grantPermissions(['local-network-access'], {
      origin: 'http://localhost:3000',
    })
    // Identity belongs to the server; a browser-supplied scope or user is refused, not obeyed.
    const forgedLoad = await page.request.get(`${API}?scope=another-user`)
    expect(forgedLoad.status()).toBe(400)
    const forgedSave = await page.request.put(`${API}/%40host/theme`, {
      data: { v: 1, d: 'dark', scope: 'another-user' },
    })
    expect(forgedSave.status()).toBe(400)
    const seeded = await page.request.put(`${API}/%40host/theme`, { data: { v: 1, d: 'light' } })
    expect(seeded.ok(), await seeded.text()).toBe(true)
    expect(await seeded.json()).toMatchObject({ v: 1, d: 'light' })

    await page.emulateMedia({ colorScheme: 'light' })
    await page.addInitScript(key => {
      // Seed once, so the reload checks the cache the runtime itself wrote.
      if (!sessionStorage.getItem('theme-test-seeded')) {
        localStorage.setItem(key, 'dark')
        sessionStorage.setItem('theme-test-seeded', 'true')
      }
    }, cacheKey)
    await page.route('http://localhost:3000/**', async route => {
      if (route.request().resourceType() !== 'document') return route.continue()
      const response = await route.fetch()
      const html = await response.text()
      // Exercise the documented server-known identity path before the runtime executes.
      const marker = '<!-- A failure before'
      if (!html.includes(marker)) throw new Error('Shell theme bootstrap marker is missing')
      await route.fulfill({
        response,
        body: html.replace('<html ', '<html data-user-id="u-2841" ').replace(
          marker,
          `<script>window.__themeBootstrap = {
            dark: document.documentElement.classList.contains('dark'),
            colorScheme: document.documentElement.style.colorScheme
          };</script>${marker}`,
        ),
      })
    })
    await page.route(API, async route => {
      if (route.request().method() !== 'GET') return route.continue()
      const response = await route.fetch()
      loadStarted = true
      await loadGate
      await route.fulfill({ response })
    })
    await page.goto('http://localhost:3000/lab/user-storage', { waitUntil: 'load' })
    await expect.poll(() => loadStarted, { timeout: 15000 }).toBe(true)
    expect(await page.evaluate(() => window.__themeBootstrap)).toEqual({
      dark: true,
      colorScheme: 'dark',
    })
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(
      page.getByText('Loading your saved preference… Current appearance: dark.'),
    ).toBeVisible()
    await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    releaseLoad()
    await expect(page.getByRole('button', { name: 'Light theme' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)
    expect(await page.evaluate(key => localStorage.getItem(key), cacheKey)).toBe('light')
    await page.unroute(API)

    const saved = page.waitForResponse(
      response =>
        response.url() === `${API}/%40host/theme` && response.request().method() === 'PUT',
    )
    await page.getByRole('button', { name: 'Dark theme' }).click()
    expect((await saved).ok()).toBe(true)
    await expect(page.getByRole('button', { name: 'Dark theme' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), cacheKey)).toBe('dark')
    await page.reload({ waitUntil: 'load' })
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Dark theme' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    await page.keyboard.press('Escape')

    const survey = page.getByRole('region', { name: 'React survey app', exact: true })
    await survey.getByLabel('Well', { exact: true }).selectOption('well-42')
    const planner = page.getByRole('region', { name: 'Angular inspection widget', exact: true })
    await expect(
      planner.getByRole('heading', { name: 'North Ridge 42', exact: true }),
    ).toBeVisible()
    const briefSaved = page.waitForResponse(
      response =>
        response.url() === `${API}/well-inspection/brief` && response.request().method() === 'PUT',
    )
    await planner.getByRole('button', { name: 'Prepare inspection', exact: true }).click()
    expect((await briefSaved).ok()).toBe(true)
    const brief = planner.getByRole('region', { name: 'Inspection brief', exact: true })
    await expect(brief).toBeVisible()
    const savedText = await brief.locator('p').innerText()
    await page.goto('http://localhost:3000/fieldwork/user-storage', { waitUntil: 'load' })
    await expect(
      page.getByRole('region', { name: 'Inspection brief', exact: true }).locator('p'),
    ).toHaveText(savedText)
    console.log(
      'User storage preferences: pre-paint cache, settings while loading, saved theme, reload and the Widget brief verified.',
    )
  } catch (error) {
    if (errors.length)
      console.error('User storage preferences browser errors:\n' + errors.slice(-20).join('\n'))
    throw error
  } finally {
    releaseLoad()
    await page.close()
  }
}
