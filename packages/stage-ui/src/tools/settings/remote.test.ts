import type { Tool } from '@xsai/shared-chat'

import { tool } from '@xsai/tool'
import { number, object } from 'valibot'
import { describe, expect, it, vi } from 'vitest'

import { invokeTool, listToolDescriptors } from './remote'

async function createVolumeTool(execute: Tool['execute'] = async input => ({ status: 'saved', input })) {
  return tool({
    name: 'set_speech_volume',
    description: 'Change the volume.',
    parameters: object({ volume: number() }),
    execute,
  })
}

describe('listToolDescriptors', () => {
  it('describes a known tool with its schema and annotations', async () => {
    const [descriptor] = listToolDescriptors([await createVolumeTool()])

    expect(descriptor.name).toBe('set_speech_volume')
    expect(descriptor.description).toBe('Change the volume.')
    expect(descriptor.parameters).toMatchObject({ type: 'object', required: ['volume'] })
    expect(descriptor.annotations).toEqual({ readOnly: false, destructive: false, idempotent: true })
  })

  it('treats an unknown tool as one that can lose data', async () => {
    const unknown = await tool({ name: 'wipe', description: 'Wipe.', parameters: object({}), execute: async () => 'done' })

    expect(listToolDescriptors([unknown])[0].annotations).toEqual({ readOnly: false, destructive: true, idempotent: false })
  })
})

describe('invokeTool', () => {
  it('runs the tool with validated arguments', async () => {
    const execute = vi.fn(async () => ({ status: 'saved' }))

    const response = await invokeTool([await createVolumeTool(execute)], 'set_speech_volume', { volume: 0.5 })

    expect(response).toEqual({ name: 'set_speech_volume', result: { status: 'saved' } })
    expect(execute).toHaveBeenCalledWith({ volume: 0.5 }, expect.objectContaining({ toolCallId: 'remote:set_speech_volume' }))
  })

  it('returns an error and does not run the tool for invalid arguments', async () => {
    const execute = vi.fn(async () => ({ status: 'saved' }))

    const response = await invokeTool([await createVolumeTool(execute)], 'set_speech_volume', { volume: 'loud' })

    expect(response).toMatchObject({ name: 'set_speech_volume', error: expect.stringContaining('Invalid arguments') })
    expect(execute).not.toHaveBeenCalled()
  })

  it('returns an error that lists the known tools for an unknown name', async () => {
    const response = await invokeTool([await createVolumeTool()], 'set_volume', {})

    expect(response).toEqual({ name: 'set_volume', error: 'Unknown tool "set_volume". Known tools: set_speech_volume' })
  })

  it('returns the error message when the tool throws', async () => {
    const failing = await createVolumeTool(async () => {
      throw new Error('Speech host disconnected')
    })

    expect(await invokeTool([failing], 'set_speech_volume', { volume: 1 })).toEqual({ name: 'set_speech_volume', error: 'Speech host disconnected' })
  })
})
