/** Real layout checks against a 30-owner runtime, built separately from the production shell. */
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdir } from 'node:fs/promises'
import { createRsbuild } from '@rsbuild/core'
import { expect } from '@playwright/test'
import { tectonResolve, useWorkspaceModules } from '../tecton/tecton-build.mjs'

export async function verifyUserContextScale(browser) {
  const shell = fileURLToPath(new URL('../../apps/shell/', import.meta.url))
  const requireFromShell = createRequire(`${shell}package.json`)
  const { pluginReact } = await import(
    pathToFileURL(requireFromShell.resolve('@rsbuild/plugin-react')).href
  )
  useWorkspaceModules(shell)
  const rsbuild = await createRsbuild({
    cwd: shell,
    rsbuildConfig: {
      plugins: [pluginReact()],
      source: { entry: { index: './src/testing/user-context-devtools.fixture.tsx' } },
      // Keep bundler error overlays out of layout tests; page errors are asserted below.
      dev: { lazyCompilation: false, client: { overlay: false } },
      server: { port: 3019, strictPort: true, publicDir: false },
      tools: { rspack: { resolve: tectonResolve(shell) } },
    },
  })
  const { server } = await rsbuild.startDevServer()
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  const shots = fileURLToPath(new URL('../../screenshots/', import.meta.url))
  await mkdir(shots, { recursive: true })
  const panel = page.locator('[data-mfe-devtools-panel]')
  const checkTabStrip = async () => {
    const strip = panel.getByRole('tablist', { name: /^Inspect .* data$/ })
    const layout = await strip.evaluate(element => {
      const viewport = element.parentElement
      const lastTab = element.querySelector('[role="tab"]:last-child')
      const indicator = getComputedStyle(lastTab, '::after')
      return {
        verticalOverflow: viewport.scrollHeight > viewport.clientHeight,
        indicatorFits:
          lastTab.getBoundingClientRect().bottom - parseFloat(indicator.bottom) <=
          viewport.getBoundingClientRect().bottom,
      }
    })
    expect(layout).toEqual({ verticalOverflow: false, indicatorFits: true })
  }
  const errors = []
  page.on('pageerror', error => {
    // Chromium reports deferred ResizeObserver delivery as a window error; it is not a thrown
    // application exception. Tecton's overflow toolbar settles it on the following frame.
    if (error.message !== 'ResizeObserver loop completed with undelivered notifications.') {
      errors.push(error.message)
    }
  })
  try {
    await page.goto('http://localhost:3019/', { waitUntil: 'load' })
    await expect(panel.getByText('30 owners · Read only')).toBeVisible()
    const list = panel.getByRole('navigation', { name: 'User-context owners' })
    await expect(list.getByRole('button')).toHaveCount(30)
    await checkTabStrip()
    const first = list.getByRole('button').first()
    expect((await first.boundingBox()).height).toBeLessThanOrEqual(32)
    const well = list.getByRole('button', { name: 'Inspect well-selection' })
    // Click the whitespace at the edge and the trailing badge, not just the label.
    await well.click({ position: { x: 3, y: 14 } })
    await expect(well).toHaveAttribute('aria-pressed', 'true')
    const second = list.getByRole('button', { name: 'Inspect assets-filters' })
    await second.locator('[data-slot="badge"]').click()
    await expect(second).toHaveAttribute('aria-pressed', 'true')
    await first.focus()
    await page.keyboard.press('End')
    await expect(list.getByRole('button').last()).toBeFocused()
    expect(await list.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await page.keyboard.press('Home')
    await expect(first).toBeFocused()
    expect(await list.evaluate(element => element.scrollTop)).toBeLessThanOrEqual(4)
    await panel.getByText('30 owners · Read only').click()
    await panel.screenshot({ path: `${shots}user-context-30-owners.png` })

    await page.getByRole('button', { name: 'Dock to the right', exact: true }).click()
    await expect(list).toBeHidden()
    // Exercise an actual narrow width using the dock's public resize control.
    const handle = await page
      .getByRole('separator', { name: 'Resize the developer tools' })
      .boundingBox()
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(780, handle.y + handle.height / 2)
    await page.mouse.up()
    const picker = page.getByLabel('Choose user-context owner', { exact: true })
    await picker.click()
    await expect(page.getByRole('option')).toHaveCount(30)
    await panel.screenshot({ path: `${shots}user-context-30-owners-narrow-picker.png` })
    const input = page.getByLabel('Find a user-context owner', { exact: true })
    await input.fill('well-selection')
    await page.getByRole('option', { name: 'well-selection', exact: true }).click()
    await expect(page.locator('[data-slot="combobox-content"]')).toHaveCount(0)
    await expect(page.getByLabel('current value of well-selection', { exact: true })).toContainText(
      'well-42',
    )
    await expect(picker).toBeFocused()
    await panel.getByText('30 owners · Read only').click()
    await panel.screenshot({ path: `${shots}user-context-30-owners-narrow.png` })
    await picker.click()
    await input.fill('no-such-owner')
    await expect(page.getByText('No owners match your search.')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(picker).toBeFocused()
    await expect(page.locator('[data-slot="combobox-content"]')).toHaveCount(0)
    await panel.getByText('30 owners · Read only').click()

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByLabel('current value of well-selection', { exact: true })).toBeVisible()
    await checkTabStrip()
    await panel.screenshot({ path: `${shots}user-context-30-owners-mobile.png` })
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    // A very short narrow dock still lets the detail body scroll independently.
    await page.setViewportSize({ width: 800, height: 360 })
    await page.getByRole('tab', { name: 'Contract', exact: true }).click()
    await checkTabStrip()
    const body = panel.getByRole('tabpanel', { name: 'Contract', exact: true })
    expect(await body.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
    await panel.screenshot({ path: `${shots}user-context-30-owners-short-dock.png` })
    expect(errors).toEqual([])
    console.log(
      'User Context scale: 30 compact full-row targets, keyboard scrolling, narrow picker, mobile and short docks verified.',
    )
  } catch (error) {
    await page.screenshot({ path: `${shots}user-context-scale-failure.png` })
    throw error
  } finally {
    await page.close()
    await server.close()
  }
}
