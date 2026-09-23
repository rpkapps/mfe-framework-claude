/**
 * `<mfe-widget>` — an Angular host placing a Widget by id. The Widget mounts itself into an element
 * this component owns, so the Widget may be an Angular one or one any other adapter built; its
 * inputs are validated by the Widget, and a contract the host declares here checks the events.
 *
 * Decorated rather than built from signals, like every component this package ships: the JIT
 * pipeline the package's own tests run under has no transform for signal inputs, and a container
 * compiles this source ahead of time with the rest of its application.
 */

import { NgTemplateOutlet } from '@angular/common'
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  inject,
  Input,
  Output,
  type OnChanges,
  type OnDestroy,
  type SimpleChanges,
  type TemplateRef,
} from '@angular/core'
import { validateAgainstContract, type MfeError, type WidgetContract } from '@company/mfe-core'
import type { MountedWidget } from '@company/mfe-host'

import { injectMfeRuntime, injectOptionalMfeMount } from '../inject/runtime.ts'
import { DefinitionSlot } from './definition-slot.ts'
import { forgetDefinition, loadDefinition } from './load-definition.ts'

export interface MfeWidgetEvent {
  readonly name: string
  readonly payload: unknown
}

@Component({
  selector: 'mfe-widget',
  imports: [NgTemplateOutlet],
  template: `@if (slot.status() === 'loading' && pending) {
    <ng-container [ngTemplateOutlet]="pending" />
  }`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MfeWidgetComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) widgetId!: string
  /** Replaced, never mutated: a new object is an update, validated by the Widget itself. */
  @Input() inputs: Readonly<Record<string, unknown>> = {}
  /** The host's own view of the contract; events that fail it are reported and not delivered. */
  @Input() contract: WidgetContract | undefined
  /** Shown while the Widget loads. */
  @Input() pending: TemplateRef<unknown> | undefined

  /** Every event the Widget emits, by name, after the Widget's contract and this host's accept it. */
  @Output() readonly event = new EventEmitter<MfeWidgetEvent>()
  /** The Widget could not be loaded or mounted; `retry()` starts a fresh attempt. */
  @Output() readonly failed = new EventEmitter<MfeError>()

  readonly #runtime = injectMfeRuntime('<mfe-widget>')
  readonly #parent = injectOptionalMfeMount()
  readonly #element: HTMLElement = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement

  protected readonly slot = new DefinitionSlot<MountedWidget>(this.#runtime, this.#element, error => {
    this.failed.emit(error)
  })

  ngOnChanges(changes: SimpleChanges): void {
    // A different Widget replaces the mount rather than feeding it another Widget's inputs.
    if (changes['widgetId']) {
      this.#start()
      return
    }
    if (changes['inputs']) this.slot.mounted?.update(this.inputs)
  }

  retry(): void {
    forgetDefinition(this.#runtime, this.widgetId)
    this.#start()
  }

  ngOnDestroy(): void {
    this.slot.stop()
  }

  #start(): void {
    const id = this.widgetId
    this.slot.start({
      id,
      kind: 'widget',
      depth: (this.#parent?.depth ?? 0) + 1,
      load: () => loadDefinition(this.#runtime, id, 'widget'),
      mount: (definition, element, context) =>
        definition.mount({
          element,
          context,
          inputs: this.inputs,
          emit: (name, payload) => {
            this.#deliver(id, name, payload)
          },
        }),
      // Inputs that changed while the Widget was mounting reach it now.
      mounted: mounted => {
        mounted.update(this.inputs)
      },
    })
  }

  /** The provider already validated the payload; this checks only what the host declared. */
  #deliver(id: string, name: string, payload: unknown): void {
    const schema = this.contract?.events[name]
    if (!schema) {
      this.event.emit({ name, payload })
      return
    }

    const accepted = validateAgainstContract(schema, payload, {
      id,
      direction: 'event',
      side: 'consumer',
      eventName: name,
    })
    if (!accepted.ok) {
      this.#runtime.diagnostics.report(accepted.error, { context: { widget: id, event: name } })
      return
    }
    this.event.emit({ name, payload: accepted.value })
  }
}
