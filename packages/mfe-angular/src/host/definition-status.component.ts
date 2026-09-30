/** Small native host surfaces shared by Angular apps and widgets. */

import { NgTemplateOutlet } from '@angular/common'
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  type TemplateRef,
} from '@angular/core'
import type { MfeError } from '@company/mfe-core'
import { definitionRecovery, definitionRecoveryMessage } from '@company/mfe-runtime'

export interface MfeFallbackContext {
  readonly $implicit: MfeError
  readonly error: MfeError
  readonly retry: () => void
  readonly reload: () => void
}

@Component({
  selector: 'mfe-definition-status',
  imports: [NgTemplateOutlet],
  template: `@if (loading) {
      @if (pending) {
        <ng-container [ngTemplateOutlet]="pending" />
      } @else {
        <p role="status">Loading feature…</p>
      }
    }
    @if (error; as failure) {
      @if (fallback) {
        <ng-container
          [ngTemplateOutlet]="fallback"
          [ngTemplateOutletContext]="fallbackContext(failure)"
        />
      } @else {
        <div role="alert" [attr.data-mfe-error]="failure.code">
          <p>{{ message(failure) }}</p>
          <details>
            <summary>Details</summary>
            <p>{{ failure.message }}</p>
            <p>
              {{ failure.code }} · {{ failure.id
              }}{{ failure.definitionVersion ? '@' + failure.definitionVersion : '' }} ·
              {{ failure.operation }} · attempt {{ attempt }}
            </p>
          </details>
          @if (recovery(failure) === 'retry' || recovery(failure) === 'correct-inputs') {
            <button type="button" (click)="retried.emit()">Retry</button>
          } @else {
            <button type="button" (click)="reloaded.emit()">Reload page</button>
          }
        </div>
      }
    }`,
  styles: ':host { display: contents; }',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MfeDefinitionStatusComponent {
  @Input() loading = false
  @Input() error: MfeError | null = null
  @Input() attempt = 0
  @Input() pending: TemplateRef<unknown> | undefined
  @Input() fallback: TemplateRef<MfeFallbackContext> | undefined
  @Output() readonly retried = new EventEmitter<void>()
  @Output() readonly reloaded = new EventEmitter<void>()

  readonly recovery = definitionRecovery
  message(error: MfeError): string {
    return definitionRecoveryMessage(this.recovery(error))
  }

  fallbackContext(error: MfeError): MfeFallbackContext {
    return {
      $implicit: error,
      error,
      retry: () => {
        this.retried.emit()
      },
      reload: () => {
        this.reloaded.emit()
      },
    }
  }
}
