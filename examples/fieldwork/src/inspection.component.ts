import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core'
import { RouterLink } from '@angular/router'

import { InspectionLog, PADS } from './inspections'

/** One inspection, at `inspections/:inspectionId`, bound by `withComponentInputBinding()`. */
@Component({
  selector: 'fieldwork-inspection',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="flex max-w-xl flex-col items-start gap-2 p-4">
      @if (inspection(); as inspection) {
        <h2 class="text-lg font-semibold">{{ inspection.title }}</h2>
        <p>{{ padName() }}, due {{ inspection.due }}.</p>
        <p>
          {{
            inspection.loggedBy === null
              ? 'Not logged yet.'
              : 'Logged by ' + inspection.loggedBy + '.'
          }}
        </p>
      } @else {
        <p>No inspection {{ inspectionId() }} is scheduled.</p>
      }
      <a class="underline" routerLink="/">Back to the inspections</a>
    </section>
  `,
})
export class InspectionComponent {
  readonly inspectionId = input.required<string>()

  readonly #log = inject(InspectionLog)

  protected readonly inspection = computed(() => this.#log.find(this.inspectionId()))
  protected readonly padName = computed(
    () => PADS.find(pad => pad.id === this.inspection()?.padId)?.name ?? 'An unknown pad',
  )
}
