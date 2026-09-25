import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { RouterLink } from '@angular/router'
import { allow, deny, injectAction, injectUser } from '@company/mfe-angular'
import { Button } from 'primeng/button'
import { Select, type SelectChangeEvent } from 'primeng/select'

import { InspectionLog, PADS } from './inspections'

@Component({
  selector: 'fieldwork-overview',
  imports: [Button, RouterLink, Select],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="fieldwork-page">
      <h1>Field inspections</h1>
      <p>Signed in as {{ user()?.name ?? 'nobody' }}.</p>
      <div class="fieldwork-row">
        <p-select
          [options]="pads"
          optionLabel="name"
          optionValue="id"
          placeholder="Choose a well pad"
          ariaLabel="Well pad"
          (onChange)="choosePad($event)"
        />
        <p-button
          label="Log inspection"
          [disabled]="padId() === null"
          (onClick)="logInspection()"
        />
      </div>
      @if (padId() !== null) {
        <ul class="fieldwork-list">
          @for (inspection of inspections(); track inspection.id) {
            <li>
              <a [routerLink]="['inspections', inspection.id]">
                {{ inspection.title }}
              </a>
              <span>{{ inspection.loggedBy === null ? 'due ' + inspection.due : 'logged' }}</span>
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class OverviewComponent {
  // A field initialiser is an injection context, so the inject functions can be called here.
  protected readonly user = injectUser()
  readonly #log = inject(InspectionLog)

  protected readonly pads = PADS

  // Zoneless: state that renders lives in signals.
  protected readonly padId = signal<string | null>(null)
  protected readonly inspections = computed(() =>
    this.#log.inspections().filter(inspection => inspection.padId === this.padId()),
  )

  constructor() {
    // The factory re-publishes the action whenever a signal it reads changes, so the palette
    // and the shortcut see the pad being chosen.
    injectAction(() => ({
      name: 'log-inspection',
      label: 'Fieldwork: log an inspection at the chosen pad',
      // The shell reserves its own keys, so an App's sequence starts with a letter it leaves free.
      shortcut: 'f l',
      canExecute: () => (this.padId() === null ? deny('Choose a well pad first.') : allow()),
      execute: () => {
        this.logInspection()
      },
    }))
  }

  protected choosePad(event: SelectChangeEvent): void {
    this.padId.set(typeof event.value === 'string' ? event.value : null)
  }

  protected logInspection(): void {
    const padId = this.padId()
    if (padId === null) return
    this.#log.log(padId, this.user()?.name ?? 'an unknown inspector')
  }
}
