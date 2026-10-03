import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core'
import { Button } from 'primeng/button'

import { formatDepth, wells } from '@example/user-context-demo/wells'
import { injectUserContext } from '#mfe/user-context/well-inspection'

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
  readonly units = injectUserContext('lab', context => context.units).value
  readonly selection = injectUserContext('lab', context => context['well-selection']).value
  readonly well = computed(() => wells.find(well => well.id === this.selection()?.wellId))
  readonly run = computed(() => this.well()?.runs.find(run => run.id === this.selection()?.runId))
  readonly depth = computed(() => {
    const run = this.run()
    return run ? formatDepth(run.depthMetres, this.units()) : 'Choose a survey'
  })
  readonly #context = injectUserContext(context => context.brief)
  readonly saving = signal(false)
  readonly error = signal('')
  readonly brief = computed(() => {
    const draft = this.#context.value()
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

  private async saveBrief(
    brief: { wellId: string; runId: string; text: string } | null,
  ): Promise<void> {
    this.saving.set(true)
    this.error.set('')
    try {
      const result = await this.#context.set('brief', brief)
      if (!result.ok) this.error.set(result.error.message)
    } finally {
      this.saving.set(false)
    }
  }
}
