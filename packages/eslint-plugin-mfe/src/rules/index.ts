/** The MFE-specific rules, keyed by the name they are configured under. */

import type { Rule } from 'eslint'
import noGlobalPatching from './no-global-patching.ts'
import noRawStorage from './no-raw-storage.ts'
import noWidgetGlobalEffects from './no-widget-global-effects.ts'
import stableDefinitions from './stable-definitions.ts'

export const rules: Record<string, Rule.RuleModule> = {
  'no-global-patching': noGlobalPatching,
  'no-raw-storage': noRawStorage,
  'no-widget-global-effects': noWidgetGlobalEffects,
  'stable-definitions': stableDefinitions,
}
