import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core'
import { injectStoredState } from '@company/mfe-angular'
import { Button } from 'primeng/button'

import { formatDepth, wells } from '@example/user-storage-demo/wells'

import { inspectionBrief, labSelection, labUnits } from './storage'

@Component({
  selector: 'well-inspection',
  imports: [Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section class="fieldwork-page" aria-label="Angular inspection widget">
    @if (well(); as well) {
      <h3>{{ well.name }}</h3>
      <p>{{ well.site }}</p>
      <p>Survey: {{ run()?.name ?? 'Choose a survey' }}</p>
      <p aria-live="polite">Inspection depth: {{ depth() }}</p>
      <p>Baseline comparison: {{ selection()?.comparisonMode === 'overlay' ? 'On' : 'Off' }}</p>
      <p>The survey and units are owned by Lab. Change them in the React review.</p>
      <p-button
        label="Prepare inspection"
        [disabled]="run() === undefined || saving()"
        (onClick)="prepareInspection()"
      />
      @if (saving()) {
        <p role="status">Saving inspection brief…</p>
      }
      @if (error(); as error) {
        <p role="alert">{{ error }}</p>
      }
      @if (brief(); as brief) {
        <section aria-label="Inspection brief">
          <h3>Inspection brief</h3>
          <p>{{ brief }}</p>
          <p-button label="Clear inspection brief" [disabled]="saving()" (onClick)="clearBrief()" />
        </section>
      }
    } @else {
      <h3>No well selected</h3>
      <p>Choose a well in the React survey review. This planner reads Lab’s selection.</p>
    }
  </section>`,
})
export class WellInspectionComponent {
  // Lab's values: read-only here, so neither has a setter.
  readonly units = injectStoredState(labUnits).value
  readonly selection = injectStoredState(labSelection).value
  readonly well = computed(() => wells.find(well => well.id === this.selection()?.wellId))
  readonly run = computed(() => this.well()?.runs.find(run => run.id === this.selection()?.runId))
  readonly depth = computed(() => {
    const run = this.run()
    return run ? formatDepth(run.depthMetres, this.units()) : 'Choose a survey'
  })
  // The Widget's own value, which it saves.
  readonly #brief = injectStoredState(inspectionBrief)
  readonly saving = computed(() => this.#brief.status() === 'saving')
  readonly error = signal('')
  readonly brief = computed(() => {
    const draft = this.#brief.value()
    return draft?.wellId === this.well()?.id && draft?.runId === this.run()?.id
      ? draft?.text
      : undefined
  })

  async prepareInspection(): Promise<void> {
    const well = this.well()
    const run = this.run()
    if (!well || !run) return
    await this.saveBrief({
      wellId: well.id,
      runId: run.id,
      text: `Inspect ${well.name} at ${well.site}, using ${run.name} at ${this.depth()}.`,
    })
  }

  async clearBrief(): Promise<void> {
    await this.saveBrief(null)
  }

  /** Saves are optimistic: a rejected one rolls the brief back and rejects with the reason. */
  private async saveBrief(
    brief: { wellId: string; runId: string; text: string } | null,
  ): Promise<void> {
    this.error.set('')
    try {
      await this.#brief.set(brief)
    } catch (cause) {
      this.error.set(cause instanceof Error ? cause.message : String(cause))
    }
  }
}
