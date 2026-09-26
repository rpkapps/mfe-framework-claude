import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createGeneratedFileWriter,
  GENERATED_INVENTORY_FILE,
  inventoryFile,
  writeGeneratedFiles,
  type GeneratedFile,
} from './emit.ts'

const created: string[] = []

afterEach(() => {
  while (created.length > 0) {
    const directory = created.pop()
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true })
  }
})

function generatedIn(contents: string): GeneratedFile {
  const directory = mkdtempSync(join(tmpdir(), 'mfe-emit-'))
  created.push(directory)
  return { path: join(directory, '.mfe/meta.ts'), contents }
}

describe('a writer for a watching build', () => {
  it('writes a file once and leaves it untouched while its contents are unchanged', () => {
    const file = generatedIn('export const buildHash = "a"\n')
    const write = createGeneratedFileWriter()

    expect(write([file])).toEqual([file])
    const { mtimeMs } = statSync(file.path)

    expect(write([file])).toEqual([])
    expect(statSync(file.path).mtimeMs).toBe(mtimeMs)
  })

  it('rewrites a file whose contents changed', () => {
    const file = generatedIn('export const buildHash = "a"\n')
    const write = createGeneratedFileWriter()
    write([file])

    const next = { ...file, contents: 'export const buildHash = "b"\n' }

    expect(write([next])).toEqual([next])
    expect(readFileSync(file.path, 'utf8')).toBe(next.contents)
  })

  it('restores a file deleted since it wrote it', () => {
    const file = generatedIn('export const buildHash = "a"\n')
    const write = createGeneratedFileWriter()
    write([file])

    rmSync(file.path)

    expect(write([file])).toEqual([file])
    expect(readFileSync(file.path, 'utf8')).toBe(file.contents)
  })

  it('restores a file edited since it wrote it', () => {
    const file = generatedIn('export const buildHash = "a"\n')
    const write = createGeneratedFileWriter()
    write([file])

    writeFileSync(file.path, 'export const buildHash = "edited by hand"\n')

    expect(write([file])).toEqual([file])
    expect(readFileSync(file.path, 'utf8')).toBe(file.contents)
  })

  it('leaves a file another run already wrote with the same contents', () => {
    const file = generatedIn('export const buildHash = "a"\n')
    createGeneratedFileWriter()([file])

    expect(createGeneratedFileWriter()([file])).toEqual([])
  })
})

describe('an inventory of the generated directory', () => {
  function generatedDir(): string {
    const directory = mkdtempSync(join(tmpdir(), 'mfe-emit-'))
    created.push(directory)
    return join(directory, '.mfe')
  }

  function run(directory: string, names: readonly string[]): readonly GeneratedFile[] {
    const files = names.map(name => ({ path: join(directory, name), contents: `// ${name}\n` }))
    return [...files, inventoryFile(directory, files)]
  }

  it('deletes a file the last run wrote and this one does not, with the directory it empties', () => {
    const directory = generatedDir()
    writeGeneratedFiles(run(directory, ['meta.ts', 'widgets/old.contract.ts']))

    writeGeneratedFiles(run(directory, ['meta.ts']))

    expect(existsSync(join(directory, 'meta.ts'))).toBe(true)
    expect(existsSync(join(directory, 'widgets/old.contract.ts'))).toBe(false)
    expect(existsSync(join(directory, 'widgets'))).toBe(false)
  })

  it('never deletes a file no run wrote', () => {
    const directory = generatedDir()
    writeGeneratedFiles(run(directory, ['meta.ts', 'config.ts']))
    writeFileSync(join(directory, 'runtime-config.json'), '{}\n')

    writeGeneratedFiles(run(directory, ['meta.ts']))

    expect(readFileSync(join(directory, 'runtime-config.json'), 'utf8')).toBe('{}\n')
    expect(existsSync(join(directory, 'config.ts'))).toBe(false)
  })

  it('never deletes outside its own directory, whatever the last inventory says', () => {
    const directory = generatedDir()
    const outside = join(directory, '../keep.ts')
    writeFileSync(outside, 'export {}\n')
    writeGeneratedFiles([
      {
        path: join(directory, GENERATED_INVENTORY_FILE),
        contents: '{ "files": ["../keep.ts"] }\n',
        inventory: true,
      },
    ])

    writeGeneratedFiles(run(directory, []))

    expect(existsSync(outside)).toBe(true)
  })
})
