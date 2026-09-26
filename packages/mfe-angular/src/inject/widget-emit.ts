/**
 * Emitting a Widget output from any component inside the Widget, not only the one the definition
 * names. It is the same validating function the Widget's outputs go through, and it throws at the
 * call site, so a bad payload fails in the provider's own stack.
 */

import { assertInInjectionContext, inject } from '@angular/core'
import { createMfeError, type ContractEmitPayloads, type WidgetContract } from '@company/mfe-core'

import { WIDGET_EMIT } from './tokens.ts'

export type WidgetEmit<C extends WidgetContract> = <
  K extends keyof ContractEmitPayloads<C> & string,
>(
  output: K,
  payload: ContractEmitPayloads<C>[K],
) => void

export function injectWidgetEmit<C extends WidgetContract = WidgetContract>(): WidgetEmit<C> {
  assertInInjectionContext(injectWidgetEmit)

  const emit = inject(WIDGET_EMIT, { optional: true })
  if (emit) return emit

  throw createMfeError({
    code: 'mount/failure',
    id: '<unmounted>',
    operation: 'call injectWidgetEmit()',
    expected: 'a component or service created inside a Widget mount',
    observed: 'one created outside any Widget',
    repair:
      'Emit from a component the Widget renders. An App has no outputs; a host listens to a Widget instead.',
  })
}
