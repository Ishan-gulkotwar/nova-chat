import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Composer } from './Composer.tsx'

function setup(props: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onSend = vi.fn()
  const onStop = vi.fn()
  render(<Composer onSend={onSend} onStop={onStop} isStreaming={false} {...props} />)
  return { onSend, onStop, user: userEvent.setup(), input: screen.getByLabelText('Message') }
}

describe('Composer', () => {
  it('sends on Enter and clears the input', async () => {
    const { onSend, user, input } = setup()
    await user.type(input, 'hello{Enter}')
    expect(onSend).toHaveBeenCalledWith('hello')
    expect(input).toHaveValue('')
  })

  it('adds a newline on Shift+Enter instead of sending', async () => {
    const { onSend, user, input } = setup()
    await user.type(input, 'line 1{Shift>}{Enter}{/Shift}line 2')
    expect(onSend).not.toHaveBeenCalled()
    expect(input).toHaveValue('line 1\nline 2')
  })

  it('does not send blank messages', async () => {
    const { onSend, user, input } = setup()
    await user.type(input, '   {Enter}')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('shows Stop while streaming', async () => {
    const { onStop, user } = setup({ isStreaming: true })
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onStop).toHaveBeenCalled()
  })
})
