import { all as supportedLocales } from '@proj-airi/i18n'
import { isLive2DControlEnabled } from '@proj-airi/stage-ui-live2d/controls/policy'
import { useTheme } from '@proj-airi/ui'
import { toRaw } from 'vue'

import { useLlmStreamingControlStore } from '../../stores/ai/chat-llm/streaming-control'
import { useDisplayModelsStore } from '../../stores/display-models'
import { useAiriCardStore } from '../../stores/modules/airi-card'
import { useConsciousnessStore } from '../../stores/modules/consciousness'
import { useSpeechStore } from '../../stores/modules/speech'
import { useProviderStore } from '../../stores/providers/provider'
import { useSettingsGeneral } from '../../stores/settings/general'
import { useSettingsStageModel } from '../../stores/settings/stage-model'
import { useSettingsTheme } from '../../stores/settings/theme'
import { useSpeechOutputControlStore } from '../../stores/speech-output-control'

export type DarkMode = 'light' | 'dark' | 'auto'

export interface NamedOption {
  id: string
  name: string
}

export interface VoiceOption extends NamedOption {
  description?: string
  gender?: string
}

export interface DisplayModelOption extends NamedOption {
  format: string
}

export interface LanguageOption {
  code: string
  name: string
}

export interface CharacterPromptFields {
  systemPrompt?: string
  personality?: string
  scenario?: string
}

/** The current values of every setting the tools can change. Built fresh on each read, never cached. */
export interface SettingsSnapshot {
  character: { id: string, name: string } | null
  chat: { provider: string, model: string }
  speech: { provider: string, model: string, voiceId: string, volume: number, muted: boolean }
  displayModel: { id: string, name: string | null, renderer: string | null }
  language: string
  theme: { hue: number, darkMode: DarkMode }
  live2d: { active: boolean, enabledExpressions: string[] }
}

/**
 * The settings that the character can read and change from a chat turn.
 *
 * Writes go through the card store where the card keeps an override (chat model, voice, displayed model), so the
 * next card activation does not undo them. Lists return only the choices the user configured and never credentials.
 * The tools validate before they write; the access layer trusts its arguments.
 */
export interface SettingsAccess {
  snapshot: () => SettingsSnapshot
  listChatProviders: () => NamedOption[]
  /** False when the provider takes free model ids, so the tools accept any non-empty model. */
  supportsModelListing: (provider: string) => boolean
  /** Fetches the catalog first. Empty when the provider does not list models. */
  listChatModels: (provider: string) => Promise<NamedOption[]>
  setChatModel: (provider: string, model: string) => Promise<boolean>
  listSpeechProviders: () => NamedOption[]
  listVoices: (provider: string, model?: string) => Promise<VoiceOption[]>
  setVoice: (provider: string, model: string, voiceId: string) => Promise<boolean>
  setSpeechVolume: (volume: number) => void
  setSpeechMuted: (muted: boolean) => void
  listDisplayModels: () => DisplayModelOption[]
  setDisplayModel: (id: string) => Promise<boolean>
  listLanguages: () => LanguageOption[]
  setLanguage: (code: string) => void
  setThemeHue: (hue: number) => void
  setDarkMode: (mode: DarkMode) => void
  /** False when no character card is active. */
  updateCharacterPrompt: (fields: CharacterPromptFields) => Promise<boolean>
  /** Runs one act payload on the stage, as an act token in the reply would. False when no stage handled it. */
  dispatchAct: (payload: Record<string, unknown>) => Promise<boolean>
}

function toNamedOption(metadata: { id: string, localizedName: string }): NamedOption {
  return { id: metadata.id, name: metadata.localizedName }
}

function toDarkMode(mode: string): DarkMode {
  return mode === 'light' || mode === 'dark' ? mode : 'auto'
}

/** Binds {@link SettingsAccess} to the stores of the window that runs the chat turn, which is the leader window. */
export function createSettingsAccess(): SettingsAccess {
  const providers = useProviderStore()
  const consciousness = useConsciousnessStore()
  const speech = useSpeechStore()
  const speechOutput = useSpeechOutputControlStore()
  const displayModels = useDisplayModelsStore()
  const stageModel = useSettingsStageModel()
  const cards = useAiriCardStore()
  const general = useSettingsGeneral()
  const theme = useSettingsTheme()
  const { themeMode } = useTheme()
  const streamingControl = useLlmStreamingControlStore()

  function enabledExpressions(): string[] {
    const model = cards.selectedAvatarModel
    if (!model || model.type !== 'live2d')
      return []

    return cards.activeLive2DModelControls.expressions
      .map(expression => expression.name)
      .filter(name => isLive2DControlEnabled(model.config.controls, { kind: 'expression', id: name }))
  }

  return {
    snapshot: () => ({
      character: cards.activeCard ? { id: cards.activeCardId, name: cards.activeCard.name } : null,
      chat: { provider: consciousness.activeProvider, model: consciousness.activeModel },
      speech: {
        provider: speech.activeSpeechProvider,
        model: speech.activeSpeechModel,
        voiceId: speech.activeSpeechVoiceId,
        volume: speechOutput.speechVolume,
        muted: speechOutput.speechMuted,
      },
      displayModel: {
        id: stageModel.stageModelSelected,
        name: stageModel.stageModelSelectedDisplayModel?.name ?? null,
        renderer: stageModel.stageModelRenderer ?? null,
      },
      language: general.language,
      theme: { hue: theme.themeColorsHue, darkMode: toDarkMode(themeMode.value) },
      live2d: { active: stageModel.stageModelRenderer === 'live2d', enabledExpressions: enabledExpressions() },
    }),
    listChatProviders: () => providers.configuredChatProvidersMetadata.map(toNamedOption),
    supportsModelListing: provider => providers.supportsModelListing(provider),
    listChatModels: async (provider) => {
      if (!providers.supportsModelListing(provider))
        return []

      await providers.fetchModelsForProvider(provider)
      return providers.getModelsForProvider(provider).map(model => ({ id: model.id, name: model.name }))
    },
    setChatModel: async (provider, model) => Boolean(await cards.updateActiveCardConsciousness({ provider, model })),
    listSpeechProviders: () => providers.configuredSpeechProvidersMetadata.map(toNamedOption),
    listVoices: async (provider, model) => {
      const voices = await speech.loadVoicesForProvider(provider, model)
      return voices.map(voice => ({ id: voice.id, name: voice.name, description: voice.description, gender: voice.gender }))
    },
    setVoice: async (provider, model, voiceId) => Boolean(await cards.updateActiveCardSpeech({ provider, model, voice_id: voiceId })),
    setSpeechVolume: volume => speechOutput.setSpeechVolume(volume),
    setSpeechMuted: muted => speechOutput.setSpeechMuted(muted),
    listDisplayModels: () => displayModels.displayModels.map(model => ({ id: model.id, name: model.name, format: model.format })),
    setDisplayModel: async id => (await cards.setActiveCardDefaultAvatarModel(id)) !== false,
    listLanguages: () => Object.entries(supportedLocales).map(([code, name]) => ({ code, name })),
    setLanguage: (code) => {
      general.language = code
    },
    setThemeHue: hue => theme.setThemeColorsHue(hue),
    setDarkMode: (mode) => {
      themeMode.value = mode
    },
    updateCharacterPrompt: async (fields) => {
      const card = cards.activeCard
      if (!card)
        return false

      return Boolean(await cards.updateCard(cards.activeCardId, { ...toRaw(card), ...fields }))
    },
    dispatchAct: payload => streamingControl.dispatchWith(`<|ACT ${JSON.stringify(payload)}|>`),
  }
}
