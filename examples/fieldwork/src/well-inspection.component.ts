import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { Button } from 'primeng/button'
import { Select, type SelectChangeEvent } from 'primeng/select'

import { formatDepth, wells } from '@example/shared-state-demo/wells'
import { injectSharedState, injectSharedStateStore } from '#mfe/shared-state/well-inspection'

@Component({
  selector: 'well-inspection',
  imports: [Button, Select, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section class="fieldwork-page" aria-label="Angular inspection widget">
    @if (well(); as well) {
      <h3>{{ well.name }}</h3>
      <p>{{ well.site }}</p>
      <p>Survey: {{ run()?.name ?? 'Choose a survey' }}</p>
      <p aria-live="polite">Inspection depth: {{ depth() }}</p>
      <p>Baseline comparison: {{ selection()?.comparisonMode === 'overlay' ? 'On' : 'Off' }}</p>
      <label for="inspection-run">Survey for inspection</label>
      <p-select
        inputId="inspection-run"
        ariaLabel="Survey for inspection"
        placeholder="Choose a survey"
        [options]="runs()"
        optionLabel="name"
        optionValue="id"
        [ngModel]="selection()?.runId"
        [disabled]="pending()"
        (onChange)="changeRun($event)"
      />
      <p>Choosing a survey here also updates the React review beside this panel.</p>
      <div class="fieldwork-row">
        <p-button
          [label]="units() === 'metric' ? 'Use feet' : 'Use metres'"
          [outlined]="true"
          [disabled]="pending()"
          (onClick)="switchUnits()"
        />
        <p-button
          label="Prepare inspection"
          [disabled]="pending() || run() === undefined"
          (onClick)="prepareInspection()"
        />
      </div>
      @if (brief(); as brief) {
        <section aria-label="Inspection brief">
          <h3>Inspection brief</h3>
          <p>{{ brief }}</p>
        </section>
      }
    } @else {
      <h3>No well selected</h3>
      <p>Choose a well in the React survey review. This planner will use that same selection.</p>
    }
    @if (error()) {
      <p role="alert">{{ error() }}</p>
    }
  </section>`,
})
export class WellInspectionComponent {
  readonly #units = injectSharedState('display:units')
  readonly #selection = injectSharedState('well:selection')
  readonly #store = injectSharedStateStore()
  readonly units = this.#units[0]
  readonly selection = this.#selection[0]
  readonly well = computed(() => wells.find(well => well.id === this.selection()?.wellId))
  readonly runs = computed(() => [...(this.well()?.runs ?? [])])
  readonly run = computed(() => this.well()?.runs.find(run => run.id === this.selection()?.runId))
  readonly depth = computed(() => {
    const run = this.run()
    return run ? formatDepth(run.depthMetres, this.units()) : 'Choose a survey'
  })
  readonly pending = signal(false)
  readonly error = signal('')
  readonly #draft = signal<{ wellId: string; runId: string; text: string } | null>(null)
  readonly brief = computed(() => {
    const draft = this.#draft()
    return draft?.wellId === this.well()?.id && draft?.runId === this.run()?.id
      ? draft?.text
      : undefined
  })

  changeRun(event: SelectChangeEvent): Promise<void> {
    const runId: unknown = event.value
    if (typeof runId !== 'string' || !this.well()?.runs.some(run => run.id === runId))
      return Promise.resolve()
    // This partial write preserves the well and comparison chosen by the React App.
    return this.save(() => this.#store.set('well:selection', { runId }))
  }
  switchUnits(): Promise<void> {
    return this.save(() => this.#units[1](this.units() === 'metric' ? 'imperial' : 'metric'))
  }
  prepareInspection(): void {
    const well = this.well()
    const run = this.run()
    if (!well || !run) return
    this.#draft.set({
      wellId: well.id,
      runId: run.id,
      text: `Inspect ${well.name} at ${well.site}, using ${run.name} at ${this.depth()}.`,
    })
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
