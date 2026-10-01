import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core'
import { ActivatedRoute } from '@angular/router'
import { Button } from 'primeng/button'
import {
  injectSharedState,
  injectSharedStateStore,
  type SharedStateValues,
} from '#mfe/shared-state'

@Component({
  selector: 'fieldwork-shared-state',
  imports: [Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ` <section class="fieldwork-page">
    <h1>Shared state: Angular</h1>
    <p>These keys come from &#64;example/shared-state-contracts, also used by the React Lab.</p>
    <p aria-live="polite">Units: {{ units() }}</p>
    <p>Well: {{ selection()?.wellId ?? 'No well selected' }}</p>
    <p>Run: {{ selection()?.runId ?? 'No run selected' }}</p>
    <p>Comparison: {{ selection()?.comparisonMode ?? 'No selection' }}</p>
    <p>The route resolver read {{ resolvedWell }} when this page opened.</p>
    @if (error()) {
      <p role="alert">{{ error() }}</p>
    }
    <div class="fieldwork-row">
      <p-button label="Switch units" [disabled]="pending()" (onClick)="switchUnits()" />
      <p-button label="Select well 42" [disabled]="pending()" (onClick)="selectWell()" />
      <p-button
        label="Change only run"
        [disabled]="pending() || selection() === null"
        (onClick)="changeRun()"
      />
      <p-button
        label="Clear selection"
        [disabled]="pending() || selection() === null"
        (onClick)="clearSelection()"
      />
    </div>
    <p>
      Enable overlay in the React Lab, then change only the run here. The comparison stays overlay.
    </p>
  </section>`,
})
export class SharedStateComponent {
  readonly #units = injectSharedState('display:units')
  readonly #selection = injectSharedState('well:selection')
  readonly #store = injectSharedStateStore()
  readonly units = this.#units[0]
  readonly selection = this.#selection[0]
  readonly error = signal('')
  readonly pending = signal(false)
  readonly resolvedWell =
    (inject(ActivatedRoute).snapshot.data['selection'] as SharedStateValues['well:selection'])
      ?.wellId ?? 'no well'

  switchUnits(): Promise<void> {
    return this.save(() => this.#units[1](this.units() === 'metric' ? 'imperial' : 'metric'))
  }
  selectWell(): Promise<void> {
    return this.save(() => this.#selection[1]({ wellId: 'well-42', runId: 'run-7' }))
  }
  changeRun(): Promise<void> {
    return this.save(() => this.#store.set('well:selection', { runId: 'run-8' }))
  }
  clearSelection(): Promise<void> {
    return this.save(() => this.#selection[1](null))
  }
  private async save(write: () => Promise<void>): Promise<void> {
    this.pending.set(true)
    try {
      await write()
      this.error.set('')
    } catch (cause) {
      this.error.set(cause instanceof Error ? cause.message : String(cause))
    } finally {
      this.pending.set(false)
    }
  }
}
