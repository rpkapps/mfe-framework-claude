import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type webpackApi from 'webpack'
import type { Configuration, Stats, WebpackPluginInstance } from 'webpack'
import { userContextTransformRule } from '@company/mfe-build'
import { cleanupContainers, createContainer } from '../testing/containers.ts'
import { planContainer } from '../plan.ts'

afterEach(cleanupContainers)

it('replaces authoring schemas after the actual Angular compiler emits JavaScript', async () => {
  // Use the example's Angular toolchain, including its compatible TypeScript peer.
  const example = createRequire(join(__dirname, '../../../../examples/fieldwork/package.json'))
  const builder = createRequire(example.resolve('@angular-devkit/build-angular/package.json'))
  const { AngularWebpackPlugin } = builder('@ngtools/webpack') as {
    AngularWebpackPlugin: new (options: {
      tsconfig: string
      jitMode: boolean
    }) => WebpackPluginInstance
  }
  const webpack = builder('webpack') as typeof webpackApi
  const root = createContainer({
    'src/mfe.ts': `import { z } from 'zod'; import { createApp } from '@company/mfe-angular';
      const schema = z.object({ selection: z.string().default('none') });
      export default createApp({ id: 'reports', routes: [], userContextSchema: schema });`,
    'src/modules.d.ts': `declare module 'zod' { export const z: any }
      declare module '@company/mfe-angular' { export function createApp(options: any): unknown }`,
    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ES2022',
        moduleResolution: 'bundler',
        skipLibCheck: true,
      },
      files: ['src/mfe.ts', 'src/modules.d.ts'],
    }),
  })
  const plan = planContainer({ containerRoot: root })
  for (const file of plan.generated.files) {
    mkdirSync(dirname(file.path), { recursive: true })
    writeFileSync(file.path, file.contents)
  }
  const config: Configuration = {
    mode: 'development',
    context: root,
    entry: plan.entryFile,
    devtool: false,
    output: { path: join(root, 'dist'), filename: 'bundle.js' },
    externals: ['zod', '@company/mfe-angular'],
    module: {
      rules: [
        { test: /\.ts$/, loader: builder.resolve('@ngtools/webpack') },
        userContextTransformRule(plan, 'post')!,
      ],
    },
    plugins: [new AngularWebpackPlugin({ tsconfig: join(root, 'tsconfig.json'), jitMode: true })],
  }
  const compiler = webpack(config)
  try {
    const stats = await new Promise<Stats>((resolve, reject) => {
      compiler.run((error, result) => {
        if (error) reject(error)
        else if (!result) reject(new Error('Angular compilation produced no stats'))
        else resolve(result)
      })
    })
    expect(stats.toJson({ all: false, errors: true }).errors).toEqual([])
    const emitted = readFileSync(join(root, 'dist/bundle.js'), 'utf8')
    expect(emitted).not.toContain('userContextSchema')
    expect(emitted).not.toContain('zod')
    expect(emitted).toContain('protocolVersion')
    expect(emitted).toContain('ownerId')
    expect(emitted).toContain('contracts')
    expect(emitted).toContain('capabilities')
  } finally {
    await new Promise<void>((resolve, reject) =>
      compiler.close(error => (error ? reject(error) : resolve())),
    )
  }
}, 60_000)
