/**
 * A schema with a `.default()` or a `.transform()` accepts one type and produces another, so each
 * side of the boundary is typed from its own end of it: a consumer and `emit` from what the schema
 * accepts, `render` and a consumer's handlers from what it produces. These are checked by the
 * package's typecheck; at run time they only have to load.
 */

import type {
  ContractEmitPayloads,
  ContractInputs,
  ContractOutputs,
  ContractParsedInputs,
} from '@company/mfe-core'
import type { ReactNode } from 'react'
import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'

import { createWidget, type WidgetRenderProps } from './definition.ts'
import { lazyWidget } from './lazy-widget.tsx'

const contract = {
  inputSchema: z.object({
    alertId: z.string(),
    severity: z.enum(['info', 'warning', 'critical']).default('info'),
    limit: z.string().transform(Number),
  }),
  outputSchema: z.object({
    acknowledged: z.object({
      alertId: z.string(),
      at: z.string().transform(value => new Date(value)),
      note: z.string().default(''),
    }),
  }),
}

type Contract = typeof contract
type Severity = 'info' | 'warning' | 'critical'

describe('the types a contract gives each side', () => {
  it('lets a consumer leave out a defaulted input and pass a transformed one as written', () => {
    expectTypeOf<ContractInputs<Contract>>().toEqualTypeOf<{
      alertId: string
      severity?: Severity | undefined
      limit: string
    }>()

    const AlertPanel = lazyWidget('alert-panel', { contract })
    expectTypeOf<{ alertId: string; limit: string }>().toExtend<Parameters<typeof AlertPanel>[0]>()

    // @ts-expect-error: `limit` is written as the string the schema turns into a number.
    void (<AlertPanel alertId="a-1" limit={10} />)
  })

  it('renders from the parsed inputs, defaults filled in', () => {
    expectTypeOf<ContractParsedInputs<Contract>>().toEqualTypeOf<{
      alertId: string
      severity: Severity
      limit: number
    }>()
    expectTypeOf<WidgetRenderProps<Contract>['inputs']>().toEqualTypeOf<
      ContractParsedInputs<Contract>
    >()
  })

  it('emits a payload as the schema accepts it, and hands handlers the parsed one', () => {
    expectTypeOf<ContractEmitPayloads<Contract>['acknowledged']>().toEqualTypeOf<{
      alertId: string
      at: string
      note?: string | undefined
    }>()
    expectTypeOf<ContractOutputs<Contract>['acknowledged']>().toEqualTypeOf<{
      alertId: string
      at: Date
      note: string
    }>()

    const AlertPanel = lazyWidget('alert-panel', { contract })
    expectTypeOf(AlertPanel)
      .parameter(0)
      .toHaveProperty('onAcknowledged')
      .toEqualTypeOf<((payload: ContractOutputs<Contract>['acknowledged']) => void) | undefined>()

    createWidget({
      id: 'alert-panel',
      ...contract,
      render: ({ inputs, emit }): ReactNode => {
        emit('acknowledged', { alertId: inputs.alertId, at: '2026-09-26T00:00:00Z' })
        // @ts-expect-error: `at` is the string the schema turns into a Date.
        emit('acknowledged', { alertId: inputs.alertId, at: new Date() })
        return null
      },
    })
  })
})
