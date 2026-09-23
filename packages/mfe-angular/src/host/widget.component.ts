/**
 * `<mfe-widget>` — an Angular host placing a Widget by id. The runtime's `mountDefinition` does the
 * placing, as it does for every host, so the Widget may be one any adapter built; the Widget
 * validates its own inputs, and a contract the host declares here checks the events.
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
  type Signal,
  type SimpleChanges,
  type TemplateRef,
} from '@angular/core'
import type { MfeError, WidgetContract } from '@company/mfe-core'
import { mountDefinition, type WidgetDefinitionMount } from '@company/mfe-runtime'

import { injectMfeRuntime, injectOptionalMfeMount } from '../inject/runtime.ts'
import { HostedMount, type MountStatus } from './hosted-mount.ts'

export interface MfeWidgetEvent {
  readonly name: string
  readonly payload: unknown
}

@Component({
  selector: 'mfe-widget',
  imports: [NgTemplateOutlet],
  template: `@if (status() === 'pending' && pending) {
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
  /** The Widget could not be loaded or mounted, or failed once mounted; `retry()` tries again. */
  @Output() readonly failed = new EventEmitter<MfeError>()

  readonly #runtime = injectMfeRuntime('<mfe-widget>')
  readonly #parent = injectOptionalMfeMount()
  readonly #element: HTMLElement = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement
  readonly #mount = new HostedMount<WidgetDefinitionMount>(error => {
    this.failed.emit(error)
  })

  /** Where the Widget's mount is: `pending`, `mounted`, `error` or `disposed`. */
  readonly status: Signal<MountStatus> = this.#mount.status

  ngOnChanges(changes: SimpleChanges): void {
    // A different Widget replaces the mount rather than feeding it another Widget's inputs.
    if (changes['widgetId']) {
      this.#place()
      return
    }
    if (changes['inputs']) this.#mount.current?.update(this.inputs)
  }

  /** Acts only after a failure; a failed load is loaded afresh. */
  retry(): void {
    this.#mount.current?.retry()
  }

  ngOnDestroy(): void {
    this.#mount.release()
  }

  #place(): void {
    // The mount reads the consumer events when an event arrives, so a contract bound later
    // applies to the Widget already mounted.
    const consumerEvents = (): WidgetContract['events'] => this.contract?.events ?? {}
    this.#mount.replace(
      mountDefinition({
        runtime: this.#runtime,
        element: this.#element,
        definitionId: this.widgetId,
        kind: 'widget',
        parent: this.#parent,
        inputs: this.inputs,
        onEvent: (name, payload) => {
          this.event.emit({ name, payload })
        },
        get consumerEvents() {
          return consumerEvents()
        },
      }),
    )
  }
}
