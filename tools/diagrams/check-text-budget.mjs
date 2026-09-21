#!/usr/bin/env node
/**
 * The text budget, enforced over the scenes rather than over the pictures.
 *
 *   node tools/diagrams/check-text-budget.mjs
 *
 * A diagram shows structure; the explanation belongs in the page beside it. So a box holds a
 * name of at most four words and at most one subtitle of at most eight, a scene holds at most
 * twelve boxes, and no piece of text anywhere runs past twelve words.
 *
 * What counts as a box: a shape with a text element bound inside it. A framed area — a panel,
 * a group, a legend swatch — carries its heading beside itself rather than bound in, which is
 * how this tells the two apart, and is why frames do not count against the twelve.
 *
 * What counts as a word: one whitespace-separated token in the hand face, ignoring a token
 * that is only punctuation and ignoring a step's leading number. In the code face a whole
 * identifier is one word — `createApp({ id: 'operations', router })` is one thing you can look
 * up — so a code line is split only on the commas outside its brackets.
 *
 * `pnpm diagrams:check` runs this first, before it renders anything.
 */

import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const toolDir = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(toolDir, '..', '..')
const scenesDir = join(toolDir, 'scenes')

export const BUDGET = {
  /** Words in a box's name. */
  name: 4,
  /** Words in a box's one subtitle. */
  subtitle: 8,
  /** Words in any single text element, wherever it sits. */
  text: 12,
  /** Boxes in one scene; frames and legend swatches are not boxes. */
  boxes: 12,
}

/** Excalidraw's `FONT_FAMILY` for Comic Shanns, the face every code identifier is set in. */
const CODE_FACE = 8

const SHAPES = new Set(['rectangle', 'ellipse', 'diamond'])
const WORDISH = /[\p{L}\p{N}]/u
const STEP_NUMBER = /^\d+[.)]?$/

/** Commas inside brackets belong to the call, not to the list. */
function splitOutsideBrackets(line) {
  const parts = []
  let depth = 0
  let current = ''

  for (const character of line) {
    if ('([{'.includes(character)) depth += 1
    else if (')]}'.includes(character)) depth -= 1

    if (character === ',' && depth <= 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += character
  }

  parts.push(current)
  return parts.map(part => part.trim()).filter(part => part !== '')
}

export function countWords(element, { stepNumber = false } = {}) {
  const lines = String(element.text ?? '').split('\n')

  if (element.fontFamily === CODE_FACE) {
    return lines.reduce((total, line) => total + splitOutsideBrackets(line).length, 0)
  }

  const tokens = lines.flatMap(line => line.split(/\s+/)).filter(token => WORDISH.test(token))
  if (stepNumber && tokens.length > 0 && STEP_NUMBER.test(tokens[0])) return tokens.length - 1
  return tokens.length
}

const boxOf = element => ({
  left: element.x,
  top: element.y,
  right: element.x + element.width,
  bottom: element.y + element.height,
})

/** `slack` forgives the pixel or two a measured text sticks out by. */
function holds(outer, inner, slack = 3) {
  return (
    inner.left >= outer.left - slack &&
    inner.right <= outer.right + slack &&
    inner.top >= outer.top - slack &&
    inner.bottom <= outer.bottom + slack
  )
}

const areaOf = element => element.width * element.height

/** Every box in one scene, with the name bound inside it and whatever text sits in it. */
function readBoxes(elements) {
  const live = elements.filter(element => element.isDeleted !== true)
  const shapes = live.filter(element => SHAPES.has(element.type))
  const texts = live.filter(element => element.type === 'text')
  const boxes = new Map()

  for (const text of texts) {
    if (typeof text.containerId !== 'string') continue
    const shape = shapes.find(candidate => candidate.id === text.containerId)
    if (shape) boxes.set(shape.id, { shape, name: text, inside: [] })
  }

  for (const text of texts) {
    if (typeof text.containerId === 'string') continue

    let smallest = null
    for (const box of boxes.values()) {
      if (!holds(boxOf(box.shape), boxOf(text))) continue
      if (smallest === null || areaOf(box.shape) < areaOf(smallest.shape)) smallest = box
    }
    if (smallest) smallest.inside.push(text)
  }

  return { boxes: [...boxes.values()], texts }
}

function inspect(name, elements) {
  const problems = []
  const { boxes, texts } = readBoxes(elements)

  if (boxes.length > BUDGET.boxes) {
    problems.push(
      `${name}: ${String(boxes.length)} boxes, and a diagram holds at most ${String(BUDGET.boxes)}. One idea per diagram.`,
    )
  }

  for (const box of boxes) {
    const label = JSON.stringify(box.name.text)
    const words = countWords(box.name, { stepNumber: true })
    if (words > BUDGET.name) {
      problems.push(
        `${name}: the name ${label} is ${String(words)} words, and a name holds at most ${String(BUDGET.name)}.`,
      )
    }

    if (box.inside.length > 1) {
      problems.push(
        `${name}: the box named ${label} holds ${String(box.inside.length)} lines under its name, and a box holds at most one subtitle.`,
      )
    }

    const subtitle = box.inside.reduce((total, text) => total + countWords(text), 0)
    if (subtitle > BUDGET.subtitle) {
      problems.push(
        `${name}: the subtitle under ${label} is ${String(subtitle)} words, and a subtitle holds at most ${String(BUDGET.subtitle)}.`,
      )
    }
  }

  for (const text of texts) {
    const words = countWords(text, { stepNumber: true })
    if (words <= BUDGET.text) continue
    problems.push(
      `${name}: ${JSON.stringify(text.text)} is ${String(words)} words. Nothing on a diagram runs past ${String(BUDGET.text)}; that sentence belongs in the README paragraph.`,
    )
  }

  return problems
}

/** Every scene, in file order; the returned lines are ready to print. */
export async function reportTextBudget() {
  let names
  try {
    names = await readdir(scenesDir)
  } catch {
    return [`No scene directory at ${relative(repoRoot, scenesDir)}.`]
  }

  const problems = []
  for (const file of names.filter(entry => entry.endsWith('.excalidraw')).sort()) {
    const raw = await readFile(join(scenesDir, file), 'utf8')
    let scene
    try {
      scene = JSON.parse(raw)
    } catch (error) {
      problems.push(
        `${file} is not readable JSON: ${(error instanceof Error && error.message) || ''}`,
      )
      continue
    }
    problems.push(...inspect(file.replace(/\.excalidraw$/, ''), scene.elements ?? []))
  }

  return problems
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = await reportTextBudget()

  if (problems.length > 0) {
    process.stderr.write(
      [
        `${String(problems.length)} box${problems.length === 1 ? '' : 'es'} over the text budget:`,
        '',
        ...problems.map(line => `  - ${line}`),
        '',
        'A box holds a name and at most one subtitle. The explanation goes in tools/diagrams/README.md.',
        '',
      ].join('\n'),
    )
    process.exit(1)
  }

  process.stdout.write('Every box is inside the text budget.\n')
}
