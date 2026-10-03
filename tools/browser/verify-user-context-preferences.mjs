/** Real API persistence and deterministic delayed hydration, while verify:page serves the shell. */
import { expect } from '@playwright/test'

export async function verifyUserContextPreferences(browser) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const scope = JSON.stringify([null, null, 'u-2841'])
  const cacheKey = `mfe:theme:${encodeURIComponent(scope)}`
  const errors = []
  page.on('pageerror', error => errors.push(`pageerror: ${error.stack ?? error.message}`))
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  let releaseHydration
  const hydrationGate = new Promise(resolve => {
    releaseHydration = resolve
  })
  let hydrationStarted = false
  try {
    // Chromium treats an intercepted document as a new address space. This test explicitly
    // permits its localhost API, as a user would when granting local-network access.
    await page.context().grantPermissions(['local-network-access'], {
      origin: 'http://localhost:3000',
    })
    // Identity belongs to the server; even a valid-looking browser-supplied scope is rejected.
    const forgedRead = await page.request.post('http://localhost:3010/api/user-context/hydrate', {
      data: { ids: ['shell'], scope: 'another-user' },
    })
    expect(forgedRead.status()).toBe(400)
    const forgedWrite = await page.request.post(
      'http://localhost:3010/api/user-context/write/shell',
      {
        data: {
          scope: 'another-user',
          id: 'shell',
          value: { preferences: { theme: 'dark' } },
        },
      },
    )
    expect(forgedWrite.status()).toBe(400)
    const seeded = await page.request.post('http://localhost:3010/api/user-context/write/shell', {
      data: {
        id: 'shell',
        value: { preferences: { theme: 'light' } },
      },
    })
    expect(seeded.ok(), await seeded.text()).toBe(true)
    await page.emulateMedia({ colorScheme: 'light' })
    await page.addInitScript(key => {
      // Seed once, so reload checks the cache written by the framework itself.
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
    await page.route('**/api/user-context/hydrate', async route => {
      if (!route.request().postDataJSON().ids.includes('shell')) return route.continue()
      const response = await route.fetch()
      hydrationStarted = true
      await hydrationGate
      await route.fulfill({ response })
    })
    await page.goto('http://localhost:3000/lab/user-context', { waitUntil: 'load' })
    await expect.poll(() => hydrationStarted, { timeout: 15000 }).toBe(true)
    expect(await page.evaluate(() => window.__themeBootstrap)).toEqual({
      dark: true,
      colorScheme: 'dark',
    })
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(
      page.getByText('Loading your saved preference… Current appearance: dark.'),
    ).toBeVisible()
    await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    releaseHydration()
    await expect(page.getByRole('button', { name: 'Light theme' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)
    expect(await page.evaluate(key => localStorage.getItem(key), cacheKey)).toBe('light')
    await page.unroute('**/api/user-context/hydrate')
    const saved = page.waitForResponse(
      response =>
        response.url().endsWith('/api/user-context/write/shell') &&
        response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: 'Dark theme' }).click()
    expect((await saved).ok()).toBe(true)
    await expect(page.getByRole('button', { name: 'Dark theme' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    expect(await page.evaluate(key => localStorage.getItem(key), cacheKey)).toBe('dark')
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
        response.url().endsWith('/api/user-context/write/well-inspection') &&
        response.request().method() === 'POST',
    )
    await planner.getByRole('button', { name: 'Prepare inspection', exact: true }).click()
    expect((await briefSaved).ok()).toBe(true)
    const brief = planner.getByRole('region', { name: 'Inspection brief', exact: true })
    await expect(brief).toBeVisible()
    const savedText = await brief.locator('p').innerText()
    await page.goto('http://localhost:3000/fieldwork/user-context', { waitUntil: 'load' })
    await expect(
      page.getByRole('region', { name: 'Inspection brief', exact: true }).locator('p'),
    ).toHaveText(savedText)
    console.log(
      'User Context preferences: prepaint cache, hook during hydration, confirmed theme writes, reload and widget brief persistence verified.',
    )
  } catch (error) {
    if (errors.length)
      console.error('User Context preferences browser errors:\n' + errors.slice(-20).join('\n'))
    throw error
  } finally {
    releaseHydration()
    await page.close()
  }
}
