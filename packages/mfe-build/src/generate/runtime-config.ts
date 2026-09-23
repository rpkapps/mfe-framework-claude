/**
 * What a deployment starts from: the declared defaults, and a script that writes the environment
 * over them when the image starts. Neither carries a deployment's value.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { ConfigField } from '../config/config-source.ts'
import { summarizeSchema, type JsonObject, type JsonValue } from '../config/zod-static.ts'
import { generatedPath, jsonFile, type GeneratedFile } from './emit.ts'
import type { GenerateContext } from './modules.ts'
import type { ContainerPlan } from '../plan.ts'

export const RUNTIME_CONFIG_DEFAULTS_FILE = 'runtime-config.defaults.json'
export const RUNTIME_CONFIG_SCRIPT_FILE = 'runtime-config.sh'

/** Where the official nginx image serves from, so its entrypoint can run the script bare. */
const DEFAULT_SERVE_DIR = '/usr/share/nginx/html'

/** Only `.default(…)` values: a required field stays absent, so the start-up script can tell. */
export function runtimeConfigDefaultsFile(context: GenerateContext): GeneratedFile | null {
  const source = context.configSource
  if (source === undefined) return null

  const defaults: Record<string, JsonValue> = {}
  for (const field of source.fields) {
    if (field.schema.hasDefault && field.schema.defaultValue !== undefined) {
      defaults[field.field] = field.schema.defaultValue
    }
  }

  return {
    path: generatedPath(context.options.generatedDir, RUNTIME_CONFIG_DEFAULTS_FILE),
    contents: jsonFile(defaults),
    // A build ships them as the configuration itself, which the start-up script writes over.
    asset: context.options.runtimeConfigFileName,
  }
}

/** The directory the dev server publishes by default, and so where local values live. */
const LOCAL_PUBLIC_DIR = 'public'

export interface LocalRuntimeConfig {
  /** Absolute path of the local file. */
  readonly path: string
  /** True when this run created or changed the file. */
  readonly written: boolean
  /** Required fields the file has no value for, which only the developer can supply. */
  readonly missing: readonly string[]
  /** Set when the file exists but could not be read as a JSON object, so it was left alone. */
  readonly unreadable?: string
}

/**
 * Seeds the dev server's copy with the declared defaults. It only ever adds a missing key: a
 * value already in the file is the developer's, so it is never changed or removed.
 */
export function seedLocalRuntimeConfig(plan: ContainerPlan): LocalRuntimeConfig | null {
  const source = plan.configSource
  if (source === undefined) return null

  const path = join(
    plan.options.containerRoot,
    LOCAL_PUBLIC_DIR,
    plan.options.runtimeConfigFileName,
  )

  let current: Record<string, unknown> = {}
  if (existsSync(path)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'))
    } catch (cause) {
      return { path, written: false, missing: [], unreadable: messageOf(cause) }
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { path, written: false, missing: [], unreadable: 'it is not a JSON object' }
    }
    current = parsed as Record<string, unknown>
  }

  const next: Record<string, unknown> = { ...current }
  const missing: string[] = []
  let added = false
  for (const field of source.fields) {
    if (field.field in next) continue
    if (field.schema.hasDefault && field.schema.defaultValue !== undefined) {
      next[field.field] = field.schema.defaultValue
      added = true
    } else if (!field.schema.optional) {
      missing.push(`${field.field} (${field.envVar}: ${summarizeSchema(field.schema)})`)
    }
  }

  const written = added || !existsSync(path)
  if (written) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, jsonFile(next), 'utf8')
  }
  return { path, written, missing }
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** How the script turns one variable's text into a JSON value. */
type Encoding = 'string' | 'boolean' | 'integer' | 'number' | 'json'

interface FieldEncoding {
  readonly encoding: Encoding
  readonly nullable: boolean
  /** Allowed values of a string enum or a string literal; empty when any string is allowed. */
  readonly members: readonly string[]
}

/** Reads the JSON Schema the build already derived, so the script and the runtime agree. */
export function fieldEncoding(schema: JsonObject): FieldEncoding {
  let node = schema
  let nullable = false

  const anyOf = node['anyOf']
  if (Array.isArray(anyOf)) {
    const branches = anyOf as readonly JsonObject[]
    const rest = branches.filter(branch => branch['type'] !== 'null')
    nullable = rest.length < branches.length
    if (rest.length === 1 && rest[0] !== undefined) node = rest[0]
    else return { encoding: 'json', nullable, members: [] }
  }

  const values = Array.isArray(node['enum'])
    ? (node['enum'] as readonly JsonValue[])
    : node['const'] !== undefined
      ? [node['const']]
      : undefined
  if (values !== undefined) {
    return values.every(value => typeof value === 'string')
      ? { encoding: 'string', nullable, members: values }
      : { encoding: 'json', nullable, members: [] }
  }

  switch (node['type']) {
    case 'string':
      return { encoding: 'string', nullable, members: [] }
    case 'boolean':
    case 'integer':
    case 'number':
      return { encoding: node['type'], nullable, members: [] }
    default:
      return { encoding: 'json', nullable, members: [] }
  }
}

/**
 * POSIX `sh` and `awk` only, so it runs in an nginx:alpine image with no Node and no jq. A set,
 * non-empty variable replaces the file's value; anything else keeps it.
 */
export function runtimeConfigScriptFile(context: GenerateContext): GeneratedFile | null {
  const source = context.configSource
  if (source === undefined) return null

  const fileName = context.options.runtimeConfigFileName
  const program = awkProgram(source.fields)

  const contents = [
    '#!/bin/sh',
    `# Generated by ${context.profile.generator} from the env() declarations in src/mfe.config.ts. Do not`,
    '# edit: the next build overwrites it.',
    '#',
    `# Writes ${context.options.packageName}'s ${fileName} from the environment when the image`,
    '# starts. A variable that is set replaces the value in the file; one that is unset or empty',
    '# keeps it, so the defaults the build wrote still apply. A required field with no value, or a',
    '# value of the wrong shape, stops the container here instead of failing in the browser.',
    '#',
    `#   runtime-config.sh [directory]    default: $MFE_RUNTIME_CONFIG_DIR, then ${DEFAULT_SERVE_DIR}`,
    '#',
    '# In the nginx image, copy it into /docker-entrypoint.d/ and the entrypoint runs it.',
    '',
    'set -eu',
    '',
    `dir=\${1:-\${MFE_RUNTIME_CONFIG_DIR:-${DEFAULT_SERVE_DIR}}}`,
    'if [ ! -d "$dir" ]; then',
    `  echo "runtime-config.sh: $dir is not a directory. Pass the directory ${fileName} is served from, or set MFE_RUNTIME_CONFIG_DIR." >&2`,
    '  exit 1',
    'fi',
    '',
    `target="$dir/${fileName}"`,
    'tmp="$target.$$.tmp"',
    'trap \'rm -f "$tmp"\' EXIT',
    '',
    '# Through the environment, because awk -v would read backslashes in a path as escapes.',
    `MFE_RUNTIME_CONFIG_TARGET="$target" MFE_RUNTIME_CONFIG_TMP="$tmp" awk '`,
    shellSingleQuoted(program),
    "'",
    'mv "$tmp" "$target"',
    '',
  ].join('\n')

  return {
    path: generatedPath(context.options.generatedDir, RUNTIME_CONFIG_SCRIPT_FILE),
    contents,
    executable: true,
  }
}

function awkProgram(fields: readonly ConfigField[]): string {
  const table: string[] = [`  n = ${fields.length}`]
  fields.forEach((field, index) => {
    const i = index + 1
    const { encoding, nullable, members } = fieldEncoding(field.schema.jsonSchema)
    // A default is written into the shipped file, so only a field with none is required here.
    const required = !field.schema.optional
    table.push(
      `  F[${i}] = ${awkString(field.field)}; V[${i}] = ${awkString(field.envVar)}; ` +
        `K[${i}] = "${encoding}"; Z[${i}] = ${nullable ? 1 : 0}; R[${i}] = ${required ? 1 : 0}; ` +
        `E[${i}] = ${members.length}`,
      `  D[${i}] = ${awkString(summarizeSchema(field.schema))}`,
    )
    for (const member of members) table.push(`  M[${i}, ${awkString(member)}] = 1`)
  })

  return [AWK_FUNCTIONS, 'BEGIN {', ...table, AWK_MAIN, '}'].join('\n')
}

/**
 * Kept to what POSIX awk, mawk and BusyBox awk share: no gawk extensions, no regex intervals,
 * no `length(array)`.
 */
const AWK_FUNCTIONS = String.raw`
function fail(message) {
  print "runtime-config.sh: " message > "/dev/stderr"
  failed = 1
}

function quote(s,   out, i, c) {
  out = ""
  for (i = 1; i <= length(s); i++) {
    c = substr(s, i, 1)
    if (c == "\\") out = out "\\\\"
    else if (c == "\"") out = out "\\\""
    else if (c == "\n") out = out "\\n"
    else if (c == "\r") out = out "\\r"
    else if (c == "\t") out = out "\\t"
    else if (c in CONTROL) out = out sprintf("\\u%04x", CONTROL[c])
    else out = out c
  }
  return "\"" out "\""
}

function encode(i, raw) {
  if (Z[i] && raw == "null") return "null"
  if (K[i] == "string") {
    if (E[i] > 0 && !((i, raw) in M)) fail(V[i] " must be " D[i] "; got " quote(raw) ".")
    return quote(raw)
  }
  if (K[i] == "boolean") {
    if (raw != "true" && raw != "false") fail(V[i] " must be true or false; got " quote(raw) ".")
    return raw
  }
  if (K[i] == "integer") {
    if (raw !~ /^-?(0|[1-9][0-9]*)$/) fail(V[i] " must be a whole number; got " quote(raw) ".")
    return raw
  }
  if (K[i] == "number") {
    if (raw !~ /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?$/) fail(V[i] " must be a number; got " quote(raw) ".")
    return raw
  }
  if (raw !~ /^[ \t\r\n]*[[{"0-9tfn-]/) fail(V[i] " must be " D[i] ", written as JSON; got " quote(raw) ".")
  return raw
}

function skip(   c) {
  while (pos <= length(text)) {
    c = substr(text, pos, 1)
    if (c != " " && c != "\t" && c != "\n" && c != "\r") return c
    pos++
  }
  return ""
}

function malformed(what) {
  fail(target " is not a flat JSON object (" what "). Fix or delete it; the build writes one with the defaults.")
  exit 1
}

# Splits the existing file into top-level members, keeping each value's text as it was.
function parse(   c, key, start, depth, instring, escaped) {
  pos = 1
  if (skip() == "") return
  if (skip() != "{") malformed("it does not start with {")
  pos++
  if (skip() == "}") return
  for (;;) {
    if (skip() != "\"") malformed("a key is not a string")
    start = ++pos
    while (pos <= length(text) && substr(text, pos, 1) != "\"") pos += (substr(text, pos, 1) == "\\") ? 2 : 1
    key = substr(text, start, pos - start)
    pos++
    if (skip() != ":") malformed("no : after \"" key "\"")
    pos++
    skip()
    start = pos; depth = 0; instring = 0; escaped = 0
    for (; pos <= length(text); pos++) {
      c = substr(text, pos, 1)
      if (instring) {
        if (escaped) escaped = 0
        else if (c == "\\") escaped = 1
        else if (c == "\"") instring = 0
      } else if (c == "\"") instring = 1
      else if (c == "{" || c == "[") depth++
      else if (c == "}" || c == "]") { if (depth == 0) break; depth-- }
      else if (c == "," && depth == 0) break
    }
    if (pos > length(text)) malformed("it ends early")
    member = substr(text, start, pos - start)
    sub(/[ \t\r\n]+$/, "", member)
    if (member == "") malformed("\"" key "\" has no value")
    if (!(key in EXISTING)) ORDER[++count] = key
    EXISTING[key] = member
    if (substr(text, pos, 1) == "}") return
    pos++
  }
}
`

const AWK_MAIN = String.raw`
  target = ENVIRON["MFE_RUNTIME_CONFIG_TARGET"]
  tmp = ENVIRON["MFE_RUNTIME_CONFIG_TMP"]
  for (i = 1; i < 32; i++) CONTROL[sprintf("%c", i)] = i

  text = ""
  while ((getline line < target) > 0) text = text line "\n"
  close(target)
  count = 0
  parse()

  out = ""; fromEnv = ""
  for (i = 1; i <= n; i++) {
    declared[F[i]] = 1
    raw = ENVIRON[V[i]]
    if (raw != "") { value = encode(i, raw); fromEnv = fromEnv (fromEnv == "" ? "" : ", ") V[i] }
    else if (F[i] in EXISTING) value = EXISTING[F[i]]
    else {
      if (R[i]) fail(V[i] " is required (" F[i] ": " D[i] "). Set it on the container.")
      continue
    }
    out = out (out == "" ? "" : ",") "\n  \"" F[i] "\": " value
  }
  # A key nobody declared is kept, so the browser reports it by name instead of it vanishing.
  for (j = 1; j <= count; j++) {
    if (!(ORDER[j] in declared)) out = out (out == "" ? "" : ",") "\n  \"" ORDER[j] "\": " EXISTING[ORDER[j]]
  }
  if (failed) exit 1

  printf "%s\n", (out == "" ? "{}" : "{" out "\n}") > tmp
  close(tmp)
  print "runtime-config.sh: wrote " target (fromEnv == "" ? " with no variables set" : " from " fromEnv)
  exit 0`

/** An awk string literal. */
function awkString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
}

/** Text placed between single quotes in `sh`, where only `'` needs breaking out. */
function shellSingleQuoted(value: string): string {
  return value.replace(/'/g, `'\\''`)
}
