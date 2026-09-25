import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it } from 'vitest'

import { says, scriptedBackend } from '../__tests__/backend.ts'
import { useChat } from './use-chat.ts'

describe('useChat', () => {
  it('renders the conversation as it changes, with stable methods', async () => {
    const backend = scriptedBackend(says('Hello there.'))
    const { result } = renderHook(() => useChat({ connection: backend.connection }))
    const { sendMessage } = result.current

    await act(() => sendMessage('Hi'))

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2)
    })
    expect(result.current.status).toBe('ready')
    expect(result.current.sendMessage).toBe(sendMessage)
  })

  it('works under Strict Mode, whose extra unmount only stops the idle client', async () => {
    const backend = scriptedBackend(says('Hello there.'))
    const { result } = renderHook(() => useChat({ connection: backend.connection }), {
      wrapper: StrictMode,
    })

    await act(() => result.current.sendMessage('Hi'))

    expect(result.current.messages).toHaveLength(2)
    expect(result.current.error).toBeUndefined()
  })
})
