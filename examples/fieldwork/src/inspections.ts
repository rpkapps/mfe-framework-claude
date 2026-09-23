import { Injectable, signal } from '@angular/core'

export interface Pad {
  readonly id: string
  readonly name: string
}

export interface Inspection {
  readonly id: string
  readonly padId: string
  readonly title: string
  readonly due: string
  readonly loggedBy: string | null
}

// PrimeNG's `options` input is a mutable array.
export const PADS: Pad[] = [
  { id: 'kestrel', name: 'Kestrel pad' },
  { id: 'osprey', name: 'Osprey pad' },
]

const SCHEDULED: readonly Inspection[] = [
  {
    id: 'k-101',
    padId: 'kestrel',
    title: 'Wellhead pressure check',
    due: '2026-10-02',
    loggedBy: null,
  },
  {
    id: 'k-102',
    padId: 'kestrel',
    title: 'Flare stack walkdown',
    due: '2026-10-09',
    loggedBy: null,
  },
  {
    id: 'o-201',
    padId: 'osprey',
    title: 'Separator valve test',
    due: '2026-10-05',
    loggedBy: null,
  },
]

/**
 * The inspection log. `providedIn: 'root'` is the root of this mount's own application, so every
 * page of one mount shares it and a second mount starts from the schedule again.
 */
@Injectable({ providedIn: 'root' })
export class InspectionLog {
  readonly #inspections = signal<readonly Inspection[]>(SCHEDULED)

  readonly inspections = this.#inspections.asReadonly()

  find(id: string): Inspection | undefined {
    return this.#inspections().find(inspection => inspection.id === id)
  }

  /** A walkdown the inspector records now, at the chosen pad. */
  log(padId: string, inspector: string): void {
    this.#inspections.update(inspections => [
      ...inspections,
      {
        id: `${padId.charAt(0)}-${String(inspections.length + 1).padStart(3, '0')}`,
        padId,
        title: 'Walkdown',
        due: new Date().toISOString().slice(0, 10),
        loggedBy: inspector,
      },
    ])
  }
}
