/**
 * Assertions the framework, react and angular preset test suites all make about a resolved
 * flat-config array, so the same behaviour is checked the same way in every suite.
 */

import { ESLint, type Linter } from 'eslint'
import { expect } from 'vitest'

export function configuredRuleIds(config: readonly { rules?: object | undefined }[]): Set<string> {
  const ids = new Set<string>()
  for (const entry of config) {
    for (const id of Object.keys(entry.rules ?? {})) ids.add(id)
  }
  return ids
}

/**
 * Every config object that turns a rule on must also register that rule's plugin, or ESLint
 * cannot resolve it. The plugin name is everything before the rule id's last `/`, except where
 * `pluginOf` names a different one — angular-eslint's template rules register under
 * `@angular-eslint/template`, not the `@angular-eslint/template/x` the rule id itself suggests.
 */
export function expectRulePluginsRegistered(
  preset: readonly Linter.Config[],
  pluginOf: (ruleId: string) => string | undefined = () => undefined,
): void {
  for (const entry of preset) {
    const registered = new Set(Object.keys(entry.plugins ?? {}))
    for (const ruleId of Object.keys(entry.rules ?? {})) {
      const separator = ruleId.lastIndexOf('/')
      if (separator === -1) continue
      const pluginName = pluginOf(ruleId) ?? ruleId.slice(0, separator)
      expect(registered, `${entry.name ?? '(unnamed)'} -> ${ruleId}`).toContain(pluginName)
    }
  }
}

export async function expectAcceptedByEslint(
  preset: readonly Linter.Config[],
  file: string,
): Promise<void> {
  const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: [...preset] })
  const resolved: unknown = await eslint.calculateConfigForFile(file)
  expect(resolved).toBeTypeOf('object')
}
