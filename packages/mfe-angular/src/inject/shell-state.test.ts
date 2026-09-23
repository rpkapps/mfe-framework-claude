import {
  Component,
  computed,
  createEnvironmentInjector,
  runInInjectionContext,
} from '@angular/core'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createHostApplication } from '../__tests__/harness.ts'
import { createWidget } from '../definition.ts'
import { createMfeTestEnvironment, mountWidget } from '../testing/index.ts'
import { injectMfeRuntime } from './runtime.ts'
import { injectGroups, injectTheme, injectUser } from './shell-state.ts'

@Component({ selector: 'test-empty', template: '' })
class EmptyComponent {}

const emptyWidget = createWidget({
  id: 'empty',
  inputs: z.object({}),
  events: {},
  component: EmptyComponent,
})

describe('the shell-state signals', () => {
  it('follow the shell inside a mount, each subscribed to its own field only', async () => {
    const environment = createMfeTestEnvironment({ shellState: { theme: 'light' } })
    const widget = await mountWidget(emptyWidget, { environment })
    const { shellState } = environment.runtime

    const { user, theme } = runInInjectionContext(widget.injector, () => ({
      user: injectUser(),
      theme: injectTheme(),
    }))
    let userReads = 0
    const userName = computed(() => {
      userReads += 1
      return user()?.name
    })
    expect(userName()).toBe('Test User')

    environment.setShellState({ theme: 'dark' })

    expect(theme()).toBe('dark')
    expect(userName()).toBe('Test User')
    expect(userReads).toBe(1)
    expect(shellState.fieldListenerCount('user')).toBe(1)
    expect(shellState.fieldListenerCount('theme')).toBe(1)
    expect(shellState.fieldListenerCount('groups')).toBe(0)

    await widget.dispose()
    expect(shellState.fieldListenerCount('user')).toBe(0)
    expect(shellState.fieldListenerCount('theme')).toBe(0)
    environment.dispose()
  })

  it('give shell chrome outside every mount the same live answers', async () => {
    const environment = createMfeTestEnvironment({ shellState: { groups: ['ops'] } })
    const appRef = await createHostApplication(environment)
    const chrome = createEnvironmentInjector([], appRef.injector)

    const groups = runInInjectionContext(chrome, () => injectGroups())
    environment.setShellState({ groups: ['ops', 'admins'] })

    expect(groups()).toEqual(['ops', 'admins'])

    chrome.destroy()
    expect(environment.runtime.shellState.fieldListenerCount('groups')).toBe(0)
    environment.dispose()
  })

  it('names the missing provider when there is neither a mount nor a runtime', async () => {
    const appRef = await createHostApplication(null)

    expect(() => runInInjectionContext(appRef.injector, () => injectTheme())).toThrowError(
      /failed to call injectTheme\(\): expected provideMfeRuntime\(runtime\) in the application providers, or an enclosing mount, received neither/,
    )
  })

  it('refuses to run outside an injection context', () => {
    expect(() => injectMfeRuntime()).toThrowError(/NG0203/)
  })
})
