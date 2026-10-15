import type { Tool } from '@xsai/shared-chat'

import type { SettingsAccess, SettingsSnapshot } from './access'

import { describe, expect, it, vi } from 'vitest'

import { createSettingsTools } from './index'

const toolOptions = {} as Parameters<Tool['execute']>[1]

function createSnapshot(overrides: Partial<SettingsSnapshot> = {}): SettingsSnapshot {
  return {
    character: { id: 'card-1', name: 'Airi' },
    chat: { provider: 'ollama', model: 'llama3' },
    speech: { provider: 'elevenlabs', model: 'eleven_v2', voiceId: 'voice-a', volume: 0.8, muted: false },
    displayModel: { id: 'preset-live2d-1', name: 'Hiyori Pro', renderer: 'live2d' },
    language: 'en',
    theme: { hue: 220, darkMode: 'auto' },
    live2d: { active: true, enabledExpressions: ['Cry', 'Love'] },
    ...overrides,
  }
}

/** A fake access layer with two chat providers, one speech provider with two voices, and two display models. */
function createAccess(overrides: Partial<SettingsAccess> = {}): SettingsAccess {
  return {
    snapshot: vi.fn(() => createSnapshot()),
    listChatProviders: vi.fn(() => [{ id: 'ollama', name: 'Ollama' }, { id: 'openai', name: 'OpenAI' }]),
    supportsModelListing: vi.fn((provider: string) => provider === 'ollama'),
    listChatModels: vi.fn(async (provider: string) => provider === 'ollama' ? [{ id: 'llama3', name: 'Llama 3' }, { id: 'qwen3', name: 'Qwen 3' }] : []),
    setChatModel: vi.fn(async () => true),
    listSpeechProviders: vi.fn(() => [{ id: 'elevenlabs', name: 'ElevenLabs' }]),
    listVoices: vi.fn(async () => [{ id: 'voice-a', name: 'Aria' }, { id: 'voice-b', name: 'Bella', gender: 'female' }]),
    setVoice: vi.fn(async () => true),
    setSpeechVolume: vi.fn(),
    setSpeechMuted: vi.fn(),
    listDisplayModels: vi.fn(() => [{ id: 'preset-live2d-1', name: 'Hiyori Pro', format: 'live2d-zip' }, { id: 'model-2', name: 'Demon Girl', format: 'live2d-zip' }]),
    setDisplayModel: vi.fn(async () => true),
    listLanguages: vi.fn(() => [{ code: 'en', name: 'English' }, { code: 'ja', name: '日本語' }]),
    setLanguage: vi.fn(),
    setThemeHue: vi.fn(),
    setDarkMode: vi.fn(),
    updateCharacterPrompt: vi.fn(async () => true),
    dispatchAct: vi.fn(async () => true),
    ...overrides,
  }
}

async function createToolMap(access: SettingsAccess) {
  const tools = await createSettingsTools(access)
  return new Map(tools.map(entry => [entry.function.name, entry]))
}

async function run(access: SettingsAccess, name: string, args: Record<string, unknown> = {}) {
  const entry = (await createToolMap(access)).get(name)
  if (!entry)
    throw new Error(`tool ${name} is missing`)
  return entry.execute(args, toolOptions)
}

describe('settings tools', () => {
  it('creates eleven tools with unique snake_case names', async () => {
    const tools = await createSettingsTools(createAccess())
    const names = tools.map(entry => entry.function.name)

    expect(names).toHaveLength(11)
    expect(new Set(names).size).toBe(11)
    expect(names.every(name => /^[a-z]+(?:_[a-z]+)*$/.test(name))).toBe(true)
  })

  it('settings_get returns the snapshot as data', async () => {
    const result = await run(createAccess(), 'settings_get')

    expect(result).toEqual({ status: 'ok', settings: createSnapshot() })
  })

  it('settings_list_options lists providers without a provider and models with one', async () => {
    const access = createAccess()

    const providers = await run(access, 'settings_list_options', { area: 'chat_models' })
    const models = await run(access, 'settings_list_options', { area: 'chat_models', provider: 'ollama' })
    const free = await run(access, 'settings_list_options', { area: 'chat_models', provider: 'openai' })
    const unknown = await run(access, 'settings_list_options', { area: 'chat_models', provider: 'nope' })

    expect(providers).toMatchObject({ status: 'ok', providers: [{ id: 'ollama', name: 'Ollama' }, { id: 'openai', name: 'OpenAI' }] })
    expect(models).toMatchObject({ status: 'ok', provider: 'ollama', models: [{ id: 'llama3', name: 'Llama 3' }, { id: 'qwen3', name: 'Qwen 3' }] })
    expect(free).toMatchObject({ status: 'ok', provider: 'openai', models: [] })
    expect(unknown).toMatchObject({ status: 'rejected', reason: 'Chat provider "nope" is not configured' })
  })

  it('settings_list_options lists voices for the active provider and model by default', async () => {
    const access = createAccess()

    const result = await run(access, 'settings_list_options', { area: 'voices' })

    expect(access.listVoices).toHaveBeenCalledWith('elevenlabs', 'eleven_v2')
    expect(result).toMatchObject({ status: 'ok', provider: 'elevenlabs', model: 'eleven_v2', voices: [{ id: 'voice-a', name: 'Aria' }, { id: 'voice-b', name: 'Bella', gender: 'female' }] })
  })

  it('settings_list_options lists display models, languages and enabled expressions', async () => {
    const access = createAccess()

    expect(await run(access, 'settings_list_options', { area: 'display_models' })).toMatchObject({ models: [{ id: 'preset-live2d-1' }, { id: 'model-2' }] })
    expect(await run(access, 'settings_list_options', { area: 'languages' })).toMatchObject({ languages: [{ code: 'en' }, { code: 'ja' }] })
    expect(await run(access, 'settings_list_options', { area: 'expressions' })).toEqual({ status: 'ok', area: 'expressions', active: true, expressions: ['Cry', 'Love'] })
  })

  it('set_chat_model validates the provider and the model before it saves', async () => {
    const access = createAccess()

    const badProvider = await run(access, 'set_chat_model', { provider: 'nope', model: 'llama3' })
    const badModel = await run(access, 'set_chat_model', { provider: 'ollama', model: 'gpt-9' })
    const saved = await run(access, 'set_chat_model', { provider: 'Ollama', model: 'Qwen 3' })

    expect(badProvider).toMatchObject({ status: 'rejected', reason: 'Chat provider "nope" is not configured' })
    expect(badModel).toMatchObject({ status: 'rejected', reason: 'Model "gpt-9" is not available for Ollama', models: [{ id: 'llama3' }, { id: 'qwen3' }] })
    expect(access.setChatModel).toHaveBeenCalledTimes(1)
    expect(access.setChatModel).toHaveBeenCalledWith('ollama', 'qwen3')
    expect(saved).toEqual({ status: 'saved', provider: 'ollama', model: 'qwen3' })
  })

  it('set_chat_model accepts any model id for a provider without a model list', async () => {
    const access = createAccess()

    const result = await run(access, 'set_chat_model', { provider: 'openai', model: 'gpt-4o-mini' })

    expect(access.listChatModels).not.toHaveBeenCalled()
    expect(access.setChatModel).toHaveBeenCalledWith('openai', 'gpt-4o-mini')
    expect(result).toEqual({ status: 'saved', provider: 'openai', model: 'gpt-4o-mini' })
  })

  it('set_chat_model reports a missing card instead of claiming success', async () => {
    const access = createAccess({ setChatModel: vi.fn(async () => false) })

    const result = await run(access, 'set_chat_model', { provider: 'ollama', model: 'llama3' })

    expect(result).toEqual({ status: 'rejected', reason: 'No active character card to save the chat model on' })
  })

  it('set_voice resolves the voice by name with the active provider and model', async () => {
    const access = createAccess()

    const result = await run(access, 'set_voice', { voice: 'bella' })

    expect(access.listVoices).toHaveBeenCalledWith('elevenlabs', 'eleven_v2')
    expect(access.setVoice).toHaveBeenCalledWith('elevenlabs', 'eleven_v2', 'voice-b')
    expect(result).toEqual({ status: 'saved', provider: 'elevenlabs', model: 'eleven_v2', voice: 'voice-b', voiceName: 'Bella' })
  })

  it('set_voice rejects an unknown voice with the available voices', async () => {
    const access = createAccess()

    const result = await run(access, 'set_voice', { voice: 'Zed' })

    expect(access.setVoice).not.toHaveBeenCalled()
    expect(result).toMatchObject({ status: 'rejected', reason: 'Voice "Zed" is not available for ElevenLabs', voices: [{ id: 'voice-a' }, { id: 'voice-b' }] })
  })

  it('set_speech_volume needs a volume or a muted value and reports the result', async () => {
    const access = createAccess({ snapshot: vi.fn(() => createSnapshot({ speech: { provider: 'elevenlabs', model: 'eleven_v2', voiceId: 'voice-a', volume: 0.3, muted: true } })) })

    const empty = await run(access, 'set_speech_volume', {})
    const result = await run(access, 'set_speech_volume', { volume: 0.3, muted: true })

    expect(empty).toEqual({ status: 'rejected', reason: 'Give a volume, a muted value, or both' })
    expect(access.setSpeechVolume).toHaveBeenCalledWith(0.3)
    expect(access.setSpeechMuted).toHaveBeenCalledWith(true)
    expect(result).toEqual({ status: 'saved', volume: 0.3, muted: true })
  })

  it('set_display_model matches by name and rejects unknown models', async () => {
    const access = createAccess()

    const saved = await run(access, 'set_display_model', { model: 'demon girl' })
    const unknown = await run(access, 'set_display_model', { model: 'Eleanor' })

    expect(access.setDisplayModel).toHaveBeenCalledWith('model-2')
    expect(saved).toEqual({ status: 'saved', model: 'model-2', name: 'Demon Girl', format: 'live2d-zip' })
    expect(unknown).toMatchObject({ status: 'rejected', reason: 'Display model "Eleanor" is not imported', models: [{ id: 'preset-live2d-1' }, { id: 'model-2' }] })
  })

  it('set_language accepts a code or a name and rejects the rest', async () => {
    const access = createAccess()

    const byName = await run(access, 'set_language', { language: '日本語' })
    const byCode = await run(access, 'set_language', { language: 'en' })
    const unknown = await run(access, 'set_language', { language: 'Klingon' })

    expect(access.setLanguage).toHaveBeenNthCalledWith(1, 'ja')
    expect(access.setLanguage).toHaveBeenNthCalledWith(2, 'en')
    expect(byName).toEqual({ status: 'saved', language: 'ja', name: '日本語' })
    expect(byCode).toEqual({ status: 'saved', language: 'en', name: 'English' })
    expect(unknown).toMatchObject({ status: 'rejected', reason: 'Language "Klingon" is not supported' })
  })

  it('set_appearance sets the hue and the dark mode', async () => {
    const access = createAccess()

    const empty = await run(access, 'set_appearance', {})
    const result = await run(access, 'set_appearance', { hue: 200, darkMode: 'dark' })

    expect(empty).toEqual({ status: 'rejected', reason: 'Give a hue, a dark mode, or both' })
    expect(access.setThemeHue).toHaveBeenCalledWith(200)
    expect(access.setDarkMode).toHaveBeenCalledWith('dark')
    expect(result).toEqual({ status: 'saved', theme: { hue: 220, darkMode: 'auto' } })
  })

  it('update_character_prompt passes only the given fields and reports a missing card', async () => {
    const access = createAccess()
    const noCard = createAccess({ updateCharacterPrompt: vi.fn(async () => false) })

    const empty = await run(access, 'update_character_prompt', {})
    const saved = await run(access, 'update_character_prompt', { scenario: 'A rainy cafe' })
    const missing = await run(noCard, 'update_character_prompt', { personality: 'calm' })

    expect(empty).toEqual({ status: 'rejected', reason: 'Give at least one of systemPrompt, personality or scenario' })
    expect(access.updateCharacterPrompt).toHaveBeenCalledWith({ scenario: 'A rainy cafe' })
    expect(saved).toEqual({ status: 'saved', updated: ['scenario'] })
    expect(missing).toEqual({ status: 'rejected', reason: 'No active character card to update' })
  })

  it('expression_set dispatches an act payload for an enabled expression', async () => {
    const access = createAccess()

    const result = await run(access, 'expression_set', { name: 'cry', duration: 3 })

    expect(access.dispatchAct).toHaveBeenCalledWith({ expression: { name: 'Cry', duration: 3 } })
    expect(result).toEqual({ status: 'saved', expression: 'Cry', duration: 3 })
  })

  it('expression_set rejects unknown expressions and an inactive Live2D stage', async () => {
    const active = createAccess()
    const inactive = createAccess({ snapshot: vi.fn(() => createSnapshot({ live2d: { active: false, enabledExpressions: [] } })) })

    const unknown = await run(active, 'expression_set', { name: 'Angry' })
    const noStage = await run(inactive, 'expression_set', { name: 'Cry' })

    expect(active.dispatchAct).not.toHaveBeenCalled()
    expect(unknown).toEqual({ status: 'rejected', reason: 'Expression "Angry" is not available', expressions: ['Cry', 'Love'] })
    expect(noStage).toEqual({ status: 'rejected', reason: 'No Live2D model is shown on the stage' })
  })

  it('expression_reset dispatches a null expression and reports a stage that did not answer', async () => {
    const access = createAccess()
    const silent = createAccess({ dispatchAct: vi.fn(async () => false) })

    const result = await run(access, 'expression_reset')
    const failed = await run(silent, 'expression_reset')

    expect(access.dispatchAct).toHaveBeenCalledWith({ expression: null })
    expect(result).toEqual({ status: 'saved' })
    expect(failed).toEqual({ status: 'rejected', reason: 'The stage did not reset the expression' })
  })

  it('turns a thrown error into a rejected result with its message', async () => {
    const access = createAccess({ listChatModels: vi.fn(async () => Promise.reject(new Error('catalog offline'))) })

    const result = await run(access, 'set_chat_model', { provider: 'ollama', model: 'llama3' })

    expect(result).toEqual({ status: 'rejected', reason: 'catalog offline' })
  })
})
