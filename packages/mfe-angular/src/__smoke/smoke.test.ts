import { Component, createComponent, EventEmitter, Input, Output, provideExperimentalZonelessChangeDetection } from '@angular/core'
import { createApplication } from '@angular/platform-browser'
import { expect, it } from 'vitest'

@Component({ selector: 'x-smoke', standalone: true, template: `<span>{{ name }}</span>` })
class Smoke {
  @Input() name = 'a'
  @Output() readonly done = new EventEmitter<string>()
}

it('works', async () => {
  const appRef = await createApplication({ providers: [provideExperimentalZonelessChangeDetection()] })
  const ref = createComponent(Smoke, { environmentInjector: appRef.injector })
  document.body.append(ref.location.nativeElement as HTMLElement)
  appRef.attachView(ref.hostView)
  ref.setInput('name', 'b')
  await appRef.whenStable()
  expect(document.body.innerHTML).toContain('<x-smoke')
  expect((ref.location.nativeElement as HTMLElement).textContent).toBe('b')
  appRef.destroy()
  expect(document.body.innerHTML).toBe('')
})
