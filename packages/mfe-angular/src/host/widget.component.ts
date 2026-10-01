/**
 * `<mfe-widget>` — an Angular host placing a Widget by id. The runtime's `mountDefinition` does the
 * placing, as it does for every host, so the Widget may be one any adapter built; the Widget
 * validates its own inputs, and a host contract checks compatibility before mounting and
 * validates output values during use.
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
import { createFallbackContext, type MfeFallbackContext } from './fallback-context.ts'

export interface MfeWidgetOutput {
  readonly name: string
  readonly payload: unknown
}

@Component({
  selector: 'mfe-widget',
  imports: [NgTemplateOutlet],
  template: `@if (status() === 'pending' && pending) {
      <ng-container [ngTemplateOutlet]="pending" />
    }
    @if (error(); as failure) {
      @if (fallback) {
        <ng-container
          [ngTemplateOutlet]="fallback"
          [ngTemplateOutletContext]="fallbackContext(failure)"
        />
      }
    }
    @if (status() === 'mounted') {
      @if (inputError(); as rejection) {
        @if (inputFallback) {
          <ng-container
            [ngTemplateOutlet]="inputFallback"
            [ngTemplateOutletContext]="{ $implicit: rejection, error: rejection }"
          />
        }
      }
    }`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MfeWidgetComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) widgetId!: string
  /** Replaced, never mutated: a new object is an update, validated by the Widget itself. */
  @Input() inputs: Readonly<Record<string, unknown>> = {}
  /** Consumer expectations checked before mounting, and again against each delivered output. */
  @Input() contract: WidgetContract | undefined
  /** Stable host identity for instance-scoped preferences. Changing it remounts the Widget. */
  @Input() instanceId: string | undefined
  /** Shown while the Widget loads. */
  @Input() pending: TemplateRef<unknown> | undefined
  @Input() fallback: TemplateRef<MfeFallbackContext> | undefined
  @Input() inputFallback:
    TemplateRef<{ readonly $implicit: MfeError; readonly error: MfeError }> | undefined

  /** Every output the Widget emits, by name, after the Widget's contract and this host's accept it. */
  @Output() readonly output = new EventEmitter<MfeWidgetOutput>()
  /** The Widget could not be loaded or mounted, or failed once mounted; `retry()` tries again. */
  @Output() readonly failed = new EventEmitter<MfeError>()
  /** The Widget still displays its last valid inputs; this update was not applied. */
  @Output() readonly inputRejected = new EventEmitter<MfeError>()

  readonly #runtime = injectMfeRuntime('<mfe-widget>')
  readonly #parent = injectOptionalMfeMount()
  readonly #element: HTMLElement = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement
  readonly #mount = new HostedMount<WidgetDefinitionMount>(error => {
    this.failed.emit(error)
  })

  /** Where the Widget's mount is: `pending`, `mounted`, `error` or `disposed`. */
  readonly status: Signal<MountStatus> = this.#mount.status
  readonly state = this.#mount.state
  readonly attempt = this.#mount.attempt
  readonly error = this.#mount.error
  readonly inputState = this.#mount.inputState
  readonly inputStatus = this.#mount.inputStatus
  readonly inputError = this.#mount.inputError
  readonly #retry = (): void => {
    this.retry()
  }
  readonly #reload = (): void => {
    this.reload()
  }

  fallbackContext(error: MfeError): MfeFallbackContext {
    return createFallbackContext(error, this.attempt(), this.#retry, this.#reload)
  }

  ngOnChanges(changes: SimpleChanges): void {
    // A different Widget replaces the mount rather than feeding it another Widget's inputs.
    if (changes['widgetId'] || changes['instanceId'] || changes['contract']) {
      this.#place()
      return
    }
    if (changes['inputs']) this.#mount.current?.update(this.inputs)
  }

  /** Acts only after a failure; a failed load is loaded afresh. */
  retry(): void {
    this.#mount.current?.retry()
  }

  reload(): void {
    this.#element.ownerDocument.defaultView?.location.reload()
  }

  ngOnDestroy(): void {
    this.#mount.release()
  }

  #place(): void {
    // Bound getters read the current contract during pending loads and output delivery.
    // Replacing the contract remounts so compatibility is checked before rendering.
    const consumerContract = (): WidgetContract | undefined => this.contract
    this.#mount.replace(
      mountDefinition({
        runtime: this.#runtime,
        element: this.#element,
        definitionId: this.widgetId,
        kind: 'widget',
        parent: this.#parent,
        inputs: this.inputs,
        instanceId: this.instanceId,
        onOutput: (name, payload) => {
          this.output.emit({ name, payload })
        },
        get consumerContract() {
          return consumerContract()
        },
        onInputRejected: error => {
          this.inputRejected.emit(error)
        },
      }),
    )
  }
}
