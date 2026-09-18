/**
 * The async-correlation gate.
 *
 * These tests pin down exactly which parent relationships the context manager
 * guarantees and which it refuses to guess. The refusals are as important as
 * the guarantees: a missing parent is a visible gap in a trace, while a wrong
 * parent is a lie that survives into production dashboards.
 */

import { describe, expect, it } from 'vitest'

import type { Span, SpanRecord, TelemetryAttribution } from '@company/mfe-core'

import { bindTelemetryContext, getActiveSpanContext } from './context.ts'
import { createRecordingTelemetryProvider } from './recording-provider.ts'
import { createMountTelemetry } from './service.ts'

function attribution(definitionId: string): TelemetryAttribution {
  return { definitionId, definitionKind: 'app', mountToken: `${definitionId}-mount` }
}

function setup(definitionId = 'operations-console') {
  const provider = createRecordingTelemetryProvider()
  const telemetry = createMountTelemetry(provider, attribution(definitionId), { dev: true })
  return { provider, telemetry, tracer: telemetry.tracer }
}

function spanNamed(provider: { readonly spans: readonly SpanRecord[] }, name: string): SpanRecord {
  const match = provider.spans.find(span => span.name === name)
  if (match === undefined) throw new Error(`no span named ${name}`)
  return match
}

function traceIdOf(span: SpanRecord): unknown {
  return span.attributes['mfe.trace.id']
}

describe('synchronous correlation (guaranteed)', () => {
  it('parents a span created synchronously inside an active callback', () => {
    const { provider, tracer } = setup()

    tracer.startActiveSpan('checkout', outer => {
      tracer.startActiveSpan('quote', inner => {
        tracer.startSpan('price-lookup').end()
        inner.end()
      })
      outer.end()
    })

    const checkout = spanNamed(provider, 'checkout')
    const quote = spanNamed(provider, 'quote')
    const lookup = spanNamed(provider, 'price-lookup')

    expect(quote.parent).toBe(checkout)
    expect(lookup.parent).toBe(quote)
    expect(checkout.parent).toBeUndefined()
    expect(traceIdOf(quote)).toBe(traceIdOf(checkout))
    expect(traceIdOf(lookup)).toBe(traceIdOf(checkout))
  })

  it('does not make startSpan active, so its siblings are not re-parented', () => {
    const { provider, tracer } = setup()

    const manual = tracer.startSpan('manual')
    tracer.startSpan('sibling').end()
    manual.end()

    expect(spanNamed(provider, 'manual').parent).toBeUndefined()
    expect(spanNamed(provider, 'sibling').parent).toBeUndefined()
  })

  it('parents a manual span under the active span without adopting its children', () => {
    const { provider, tracer } = setup()

    tracer.startActiveSpan('checkout', outer => {
      const manual = tracer.startSpan('manual')
      tracer.startSpan('after-manual').end()
      manual.end()
      outer.end()
    })

    const checkout = spanNamed(provider, 'checkout')
    expect(spanNamed(provider, 'manual').parent).toBe(checkout)
    // Still the active span's child, not the manual span's child.
    expect(spanNamed(provider, 'after-manual').parent).toBe(checkout)
  })

  it('restores the previous context after the callback returns or throws', () => {
    const { provider, tracer } = setup()

    expect(getActiveSpanContext()).toBeUndefined()
    tracer.startActiveSpan('checkout', span => {
      expect(getActiveSpanContext()?.name).toBe('checkout')
      span.end()
    })
    expect(getActiveSpanContext()).toBeUndefined()

    expect(() =>
      tracer.startActiveSpan('boom', () => {
        throw new Error('exploded')
      }),
    ).toThrow('exploded')
    expect(getActiveSpanContext()).toBeUndefined()

    tracer.startSpan('after-throw').end()
    expect(spanNamed(provider, 'after-throw').parent).toBeUndefined()
  })

  it('keeps a deep nest in order', () => {
    const { provider, tracer } = setup()

    tracer.startActiveSpan('l1', one => {
      tracer.startActiveSpan('l2', two => {
        tracer.startActiveSpan('l3', three => {
          three.end()
        })
        tracer.startSpan('l2-sibling').end()
        two.end()
      })
      tracer.startSpan('l1-sibling').end()
      one.end()
    })

    expect(spanNamed(provider, 'l3').parent).toBe(spanNamed(provider, 'l2'))
    expect(spanNamed(provider, 'l2-sibling').parent).toBe(spanNamed(provider, 'l2'))
    expect(spanNamed(provider, 'l1-sibling').parent).toBe(spanNamed(provider, 'l1'))
  })
})

describe('correlation across await (the documented limit)', () => {
  it('parents the synchronous prologue of an async callback', async () => {
    const { provider, tracer } = setup()

    await tracer.startActiveSpan('checkout', async span => {
      tracer.startSpan('before-await').end()
      await Promise.resolve()
      span.end()
    })

    expect(spanNamed(provider, 'before-await').parent).toBe(spanNamed(provider, 'checkout'))
  })

  it('gives a span created after an await NO parent rather than a wrong one', async () => {
    const { provider, tracer } = setup()

    await tracer.startActiveSpan('checkout', async span => {
      await Promise.resolve()
      tracer.startSpan('after-await').end()
      span.end()
    })

    // The synchronous region ended at the await, and a browser hands back no
    // way to know which logical operation resumed. The span becomes a root.
    const afterAwait = spanNamed(provider, 'after-await')
    expect(afterAwait.parent).toBeUndefined()
    expect(traceIdOf(afterAwait)).not.toBe(traceIdOf(spanNamed(provider, 'checkout')))
  })

  it('keeps sequential awaits root-level and never chains them to each other', async () => {
    const { provider, tracer } = setup()

    await tracer.startActiveSpan('checkout', async span => {
      await Promise.resolve()
      tracer.startSpan('step-one').end()
      await Promise.resolve()
      tracer.startSpan('step-two').end()
      span.end()
    })

    expect(spanNamed(provider, 'step-one').parent).toBeUndefined()
    expect(spanNamed(provider, 'step-two').parent).toBeUndefined()
    expect(traceIdOf(spanNamed(provider, 'step-one'))).not.toBe(
      traceIdOf(spanNamed(provider, 'step-two')),
    )
  })

  it('restores the parent when the continuation is wrapped with bindTelemetryContext', async () => {
    const { provider, tracer } = setup()

    await tracer.startActiveSpan('checkout', async span => {
      // Captured while the span is still active: this is the supported way to
      // keep an asynchronous continuation correlated.
      const continueWork = bindTelemetryContext(() => {
        tracer.startSpan('after-await-bound').end()
      })
      await Promise.resolve()
      continueWork()
      span.end()
    })

    const checkout = spanNamed(provider, 'checkout')
    const bound = spanNamed(provider, 'after-await-bound')
    expect(bound.parent).toBe(checkout)
    expect(traceIdOf(bound)).toBe(traceIdOf(checkout))
  })

  it('passes arguments, results and throws through a bound callback unchanged', () => {
    const { tracer } = setup()

    const bound = tracer.startActiveSpan('checkout', (span: Span) => {
      const wrapped = bindTelemetryContext((a: number, b: number) => a + b)
      const thrower = bindTelemetryContext(() => {
        throw new Error('bound throw')
      })
      span.end()
      return { wrapped, thrower }
    })

    expect(bound.wrapped(2, 3)).toBe(5)
    expect(() => bound.thrower()).toThrow('bound throw')
    expect(getActiveSpanContext()).toBeUndefined()
  })

  it('makes a bound callback harmless after the mount was disposed', async () => {
    const { provider, telemetry, tracer } = setup()

    const bound = tracer.startActiveSpan('checkout', span => {
      const later = bindTelemetryContext(() => tracer.startSpan('too-late'))
      span.end()
      return later
    })

    telemetry.dispose()
    await Promise.resolve()

    const span = bound()
    expect(span.isRecording()).toBe(false)
    expect(provider.spansNamed('too-late')).toHaveLength(0)
  })
})

describe('concurrent operations', () => {
  it('keeps two operations started with Promise.all separate', async () => {
    const { provider, tracer } = setup()

    async function operation(name: string): Promise<string> {
      return tracer.startActiveSpan(name, async span => {
        tracer.startSpan(`${name}.sync`).end()
        await Promise.resolve()
        tracer.startSpan(`${name}.async`).end()
        span.end()
        return name
      })
    }

    const results = await Promise.all([operation('op-a'), operation('op-b')])
    expect(results).toEqual(['op-a', 'op-b'])

    const a = spanNamed(provider, 'op-a')
    const b = spanNamed(provider, 'op-b')
    // Each synchronous prologue is correlated to its own operation.
    expect(spanNamed(provider, 'op-a.sync').parent).toBe(a)
    expect(spanNamed(provider, 'op-b.sync').parent).toBe(b)
    // The continuations are roots. Crucially, neither was adopted by the other
    // operation: an incorrect parent would be worse than no parent.
    for (const name of ['op-a.async', 'op-b.async']) {
      const span = spanNamed(provider, name)
      expect(span.parent).toBeUndefined()
      expect(traceIdOf(span)).not.toBe(traceIdOf(a))
      expect(traceIdOf(span)).not.toBe(traceIdOf(b))
    }
  })

  it('correlates both continuations when each binds its own context', async () => {
    const { provider, tracer } = setup()

    async function operation(name: string): Promise<void> {
      return tracer.startActiveSpan(name, async span => {
        const resume = bindTelemetryContext(() => {
          tracer.startSpan(`${name}.bound`).end()
        })
        await Promise.resolve()
        resume()
        span.end()
      })
    }

    await Promise.all([operation('op-a'), operation('op-b')])

    expect(spanNamed(provider, 'op-a.bound').parent).toBe(spanNamed(provider, 'op-a'))
    expect(spanNamed(provider, 'op-b.bound').parent).toBe(spanNamed(provider, 'op-b'))
  })

  it('does not let a nested startActiveSpan inside a bound callback escape its trace', async () => {
    const { provider, tracer } = setup()

    const resume = tracer.startActiveSpan('outer', span => {
      const bound = bindTelemetryContext(() => {
        tracer.startActiveSpan('inner', child => {
          tracer.startSpan('grandchild').end()
          child.end()
        })
      })
      span.end()
      return bound
    })

    await Promise.resolve()
    resume()

    const outer = spanNamed(provider, 'outer')
    expect(spanNamed(provider, 'inner').parent).toBe(outer)
    expect(spanNamed(provider, 'grandchild').parent).toBe(spanNamed(provider, 'inner'))
    expect(traceIdOf(spanNamed(provider, 'grandchild'))).toBe(traceIdOf(outer))
  })
})

describe('two mounts interleaved', () => {
  it('never lets one mount become the parent of another mount span', () => {
    const app = setup('operations-console')
    const widget = setup('alert-panel')

    app.tracer.startActiveSpan('app-root', appSpan => {
      // The widget mounts and traces while the app span is active.
      widget.tracer.startActiveSpan('widget-root', widgetSpan => {
        widget.tracer.startSpan('widget-child').end()
        app.tracer.startSpan('app-child-inside-widget').end()
        widgetSpan.end()
      })
      appSpan.end()
    })

    const appRoot = spanNamed(app.provider, 'app-root')
    const widgetRoot = spanNamed(widget.provider, 'widget-root')

    expect(widgetRoot.parent).toBeUndefined()
    expect(traceIdOf(widgetRoot)).not.toBe(traceIdOf(appRoot))
    expect(spanNamed(widget.provider, 'widget-child').parent).toBe(widgetRoot)
    // The app's own span, created while the widget's context is active, is not
    // adopted by the widget: ownership is checked before parentage.
    expect(spanNamed(app.provider, 'app-child-inside-widget').parent).toBeUndefined()
  })

  it('restores each mount context after the other mount finishes its region', () => {
    const app = setup('operations-console')
    const widget = setup('alert-panel')

    app.tracer.startActiveSpan('app-root', appSpan => {
      widget.tracer.startActiveSpan('widget-root', widgetSpan => {
        widgetSpan.end()
      })
      // Back under the app's own context.
      expect(getActiveSpanContext()?.name).toBe('app-root')
      app.tracer.startSpan('app-child-after-widget').end()
      appSpan.end()
    })

    expect(spanNamed(app.provider, 'app-child-after-widget').parent).toBe(
      spanNamed(app.provider, 'app-root'),
    )
    expect(getActiveSpanContext()).toBeUndefined()
  })

  it('keeps two mounts sharing one provider on separate traces', async () => {
    const provider = createRecordingTelemetryProvider()
    const app = createMountTelemetry(provider, attribution('operations-console'), { dev: true })
    const widget = createMountTelemetry(provider, attribution('alert-panel'), { dev: true })

    await Promise.all([
      app.tracer.startActiveSpan('app-work', async span => {
        app.tracer.startSpan('app-step').end()
        await Promise.resolve()
        span.end()
      }),
      widget.tracer.startActiveSpan('widget-work', async span => {
        widget.tracer.startSpan('widget-step').end()
        await Promise.resolve()
        span.end()
      }),
    ])

    const appStep = spanNamed(provider, 'app-step')
    const widgetStep = spanNamed(provider, 'widget-step')
    expect(appStep.parent).toBe(spanNamed(provider, 'app-work'))
    expect(widgetStep.parent).toBe(spanNamed(provider, 'widget-work'))
    expect(appStep.attribution.definitionId).toBe('operations-console')
    expect(widgetStep.attribution.definitionId).toBe('alert-panel')
    expect(traceIdOf(appStep)).not.toBe(traceIdOf(widgetStep))
  })

  it('leaves the other mount untouched when one mount is disposed mid-flight', () => {
    const app = setup('operations-console')
    const widget = setup('alert-panel')

    app.tracer.startActiveSpan('app-root', appSpan => {
      widget.telemetry.dispose()
      expect(widget.tracer.startSpan('widget-after-dispose').isRecording()).toBe(false)
      app.tracer.startSpan('app-child').end()
      appSpan.end()
    })

    expect(spanNamed(app.provider, 'app-child').parent).toBe(spanNamed(app.provider, 'app-root'))
    expect(widget.provider.spans).toHaveLength(0)
  })
})
