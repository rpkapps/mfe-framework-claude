import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createGeneratedFileWriter, type GeneratedFile } from './emit.ts'

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
