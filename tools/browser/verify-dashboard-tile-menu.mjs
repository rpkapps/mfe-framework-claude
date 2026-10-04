/**
 * Real-browser coverage, called while verify:page has the shell and containers running. The
 * tile's options menu renders in a portal, and React bubbles a press there up to the tile header,
 * which starts a drag and captures the pointer, so no menu item could be chosen.
 */
import { expect } from '@playwright/test'

export async function verifyDashboardTileMenu(browser) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  try {
    await page.goto('http://localhost:3000/', { waitUntil: 'load' })
    await page
      .getByRole('button', { name: 'Add Alert panel to the dashboard', exact: true })
      .click()
    const confirm = page.getByRole('button', { name: 'Add to dashboard', exact: true })
    if (await confirm.isVisible()) await confirm.click()
    const options = page.getByRole('button', { name: 'Tile options', exact: true })
    await expect(options).toHaveCount(1)

    await options.click()
    await page.getByRole('menuitem', { name: 'Small', exact: true }).click()
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect
      .poll(() =>
        page.evaluate(() => JSON.parse(localStorage.getItem('@host:dashboard')).d.tiles[0]),
      )
      .toMatchObject({ w: 16, h: 10 })

    await options.click()
    await page.getByRole('menuitem', { name: 'Remove from dashboard', exact: true }).click()
    await expect(options).toHaveCount(0)
    console.log('  ok   the dashboard tile menu resizes and removes a tile')
  } finally {
    await page.close()
  }
}
