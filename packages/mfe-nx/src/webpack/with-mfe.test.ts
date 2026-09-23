import { afterEach, describe, expect, it } from 'vitest'
import type { Configuration, WebpackPluginInstance } from 'webpack'

import { cleanupContainers, createContainer } from '../testing/containers.ts'
import { MfeWebpackPlugin } from './plugin.ts'
import { withMfe } from './with-mfe.ts'

afterEach(cleanupContainers)

const WIDGET_ENTRY = `
import { createWidget } from '@company/mfe-angular'
import { z } from 'zod'

class PanelComponent {}

export const panel = createWidget({ id: 'panel', inputs: z.object({}), events: {}, component: PanelComponent })
`

class AngularOwnPlugin implements WebpackPluginInstance {
  apply(): void {}
}

describe('withMfe', () => {
  it('adds one plugin after the builder’s own and leaves the rest of the configuration alone', async () => {
    const root = createContainer({ 'src/mfe.ts': WIDGET_ENTRY })
    const own = new AngularOwnPlugin()
    const config: Configuration = {
      mode: 'production',
      entry: { main: ['./src/main.ts'] },
      output: { publicPath: '' },
      plugins: [own],
    }

    const result = await withMfe({ containerRoot: root })(config)

    expect(result.plugins).toHaveLength(2)
    expect(result.plugins?.[0]).toBe(own)
    expect(result.plugins?.[1]).toBeInstanceOf(MfeWebpackPlugin)
    expect(result.entry).toBe(config.entry)
    expect(result.output).toBe(config.output)
    // The builder's own object is never modified in place.
    expect(config.plugins).toEqual([own])
  })

  it('names the option to set when there is neither a container root nor an Nx target', async () => {
    await expect(withMfe()({ plugins: [] })).rejects.toThrowError(
      /find the container this webpack configuration builds.*no target.*withMfe\(\{ containerRoot \}\)/s,
    )
  })
})
