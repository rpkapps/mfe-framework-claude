/**
 * `<mfe-app-host>` — an Angular host placing an App at a URL boundary. Used directly it takes the
 * App and the boundary as inputs; placed by `mfeAppRoute` it reads the App from its route and
 * derives the boundary from where the route matched, remounting if that ever moves. The runtime's
 * `mountDefinition` does the placing, as it does for every host, so the App may be one any adapter
 * built.
 */

import { Location, NgTemplateOutlet } from '@angular/common'
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  inject,
  Injector,
  Input,
  Output,
  type OnChanges,
  type OnDestroy,
  type OnInit,
  type Signal,
  type TemplateRef,
} from '@angular/core'
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router'
import { createMfeError, type MfeError } from '@company/mfe-core'
import { mountDefinition, type DefinitionMount } from '@company/mfe-runtime'
import { filter, type Subscription } from 'rxjs'

import { injectMfeRuntime, injectOptionalMfeMount } from '../inject/runtime.ts'
import { readAppRoute } from '../routing/app-route-data.ts'
import { HostedMount, type MountStatus } from './hosted-mount.ts'

interface Placement {
  readonly appId: string
  readonly basePath: string
}

/** The URL the route matched, as the page shows it: every ancestor's segments and its own. */
function boundaryOf(route: ActivatedRoute, location: Location): string {
  const segments = route.snapshot.pathFromRoot.flatMap(step => step.url.map(({ path }) => path))
  return location.prepareExternalUrl(`/${segments.join('/')}`)
}

@Component({
  selector: 'mfe-app-host',
  imports: [NgTemplateOutlet],
  template: `@if (status() === 'pending' && pending) {
    <ng-container [ngTemplateOutlet]="pending" />
  }`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MfeAppHostComponent implements OnChanges, OnInit, OnDestroy {
  /** Omitted when `mfeAppRoute` placed this component; the route names the App instead. */
  @Input() appId: string | undefined
  /** The URL boundary assigned to the App; everything below it is the App's. */
  @Input() basePath: string | undefined
  /** Shown while the App loads. */
  @Input() pending: TemplateRef<unknown> | undefined

  /** The App could not be loaded or mounted, or failed once mounted; `retry()` tries again. */
  @Output() readonly failed = new EventEmitter<MfeError>()

  readonly #runtime = injectMfeRuntime('<mfe-app-host>')
  readonly #parent = injectOptionalMfeMount()
  readonly #injector = inject(Injector)
  readonly #route = inject(ActivatedRoute, { optional: true })
  readonly #element: HTMLElement = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement
  #initialized = false
  #placement: Placement | null = null
  #navigations: Subscription | null = null
  readonly #mount = new HostedMount<DefinitionMount>(error => {
    this.failed.emit(error)
  })

  /** Where the App's mount is: `pending`, `mounted`, `error` or `disposed`. */
  readonly status: Signal<MountStatus> = this.#mount.status

  // The first placement waits for `ngOnInit`, which runs whether or not an input is bound; placed
  // by `mfeAppRoute`, none is, and Angular never calls `ngOnChanges` at all.
  ngOnInit(): void {
    this.#initialized = true
    this.#place()
  }

  ngOnChanges(): void {
    if (this.#initialized) this.#place()
  }

  /** Acts only after a failure; a failed load is loaded afresh. */
  retry(): void {
    this.#mount.current?.retry()
  }

  ngOnDestroy(): void {
    this.#navigations?.unsubscribe()
    this.#mount.release()
  }

  /** The App and its boundary together are the mount's identity; a change to either remounts. */
  #place(): void {
    const next = this.#resolvePlacement()
    if (next === null) return
    if (next.appId === this.#placement?.appId && next.basePath === this.#placement.basePath) return
    this.#start(next)
  }

  #start(placement: Placement): void {
    this.#placement = placement
    this.#mount.replace(
      mountDefinition({
        runtime: this.#runtime,
        element: this.#element,
        definitionId: placement.appId,
        kind: 'app',
        basePath: placement.basePath,
        parent: this.#parent,
      }),
    )
  }

  #resolvePlacement(): Placement | null {
    if (this.appId !== undefined) {
      return { appId: this.appId, basePath: this.basePath ?? `/${this.appId}` }
    }

    const routed = this.#route === null ? null : readAppRoute(this.#route.snapshot.data)
    if (routed === null || this.#route === null) {
      this.failed.emit(
        createMfeError({
          code: 'mount/failure',
          id: '<app>',
          operation: 'place an App',
          expected: 'an appId input, or placement by mfeAppRoute',
          observed: 'neither',
          repair: 'Write <mfe-app-host appId="…" basePath="…" />, or route to it with mfeAppRoute.',
        }),
      )
      return null
    }

    // Read only on the routed path, where the router exists: injecting it anywhere else would
    // create a router for a host that has none.
    const route = this.#route
    const location = this.#injector.get(Location)
    this.#navigations ??= this.#injector
      .get(Router)
      .events.pipe(filter(event => event instanceof NavigationEnd))
      .subscribe(() => {
        this.#place()
        // A router over the page's own history moves the page without the navigation bridge
        // hearing of it, so the App below this route is told here; one whose router writes
        // through the runtime's navigator has already been told, and hears nothing twice.
        this.#runtime.navigator.announce()
      })

    return { appId: routed.appId, basePath: routed.basePath ?? boundaryOf(route, location) }
  }
}
