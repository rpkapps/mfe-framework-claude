import { ChangeDetectionStrategy, Component } from '@angular/core'
import { MfeWidgetComponent } from '@company/mfe-angular'
import { Button } from 'primeng/button'

@Component({
  selector: 'fieldwork-shared-state',
  imports: [MfeWidgetComponent, Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section class="fieldwork-page">
    <h1>Well inspections</h1>
    <p>The survey App's selection is available here too.</p>
    <mfe-widget widgetId="well-inspection" [pending]="loading" [fallback]="failure" />
    <ng-template #loading><p role="status">Loading the inspection planner…</p></ng-template>
    <ng-template #failure let-failure>
      <p role="alert">{{ failure.error.message }}</p>
      <p-button label="Retry inspection planner" (onClick)="failure.retry()" />
    </ng-template>
  </section>`,
})
export class SharedStateComponent {}
