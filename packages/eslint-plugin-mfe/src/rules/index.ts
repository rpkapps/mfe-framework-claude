import type { Rule } from 'eslint'
import noGlobalPatching from './no-global-patching.ts'
import noRawStorage from './no-raw-storage.ts'
import noWidgetGlobalEffects from './no-widget-global-effects.ts'
import noWidgetGlobalRouter from './no-widget-global-router.ts'
import stableDefinitions from './stable-definitions.ts'

export const rules: Record<string, Rule.RuleModule> = {
  'no-global-patching': noGlobalPatching,
  'no-raw-storage': noRawStorage,
  'no-widget-global-effects': noWidgetGlobalEffects,
  'no-widget-global-router': noWidgetGlobalRouter,
  'stable-definitions': stableDefinitions,
}
