import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core'
import { Button } from 'primeng/button'

import { formatDepth, wells } from '@example/user-context-demo/wells'
import { injectUserContext } from '#mfe/user-context/well-inspection'
import type { LabUserContext } from './user-context.schema'

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
        [disabled]="run() === undefined"
        (onClick)="prepareInspection()"
      />
      @if (brief(); as brief) {
        <section aria-label="Inspection brief">
          <h3>Inspection brief</h3>
          <p>{{ brief }}</p>
        </section>
      }
    } @else {
      <h3>No well selected</h3>
      <p>Choose a well in the React survey review. This planner reads Lab’s selection.</p>
    }
  </section>`,
})
export class WellInspectionComponent {
  readonly #lab = injectUserContext<LabUserContext>('lab')
  readonly units = computed(() => this.#lab.get('display:units'))
  readonly selection = computed(() => this.#lab.get('well:selection'))
  readonly well = computed(() => wells.find(well => well.id === this.selection()?.wellId))
  readonly run = computed(() => this.well()?.runs.find(run => run.id === this.selection()?.runId))
  readonly depth = computed(() => {
    const run = this.run()
    return run ? formatDepth(run.depthMetres, this.units()) : 'Choose a survey'
  })
  readonly #draft = signal<{ wellId: string; runId: string; text: string } | null>(null)
  readonly brief = computed(() => {
    const draft = this.#draft()
    return draft?.wellId === this.well()?.id && draft?.runId === this.run()?.id
      ? draft?.text
      : undefined
  })

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
}
