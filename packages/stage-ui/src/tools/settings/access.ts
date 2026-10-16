import type { HomeAssistantExposureMode } from '../../libs/home-assistant/exposure'
import type { HearingInputMode } from '../../stores/modules/hearing'
import type { McpServersAccess } from '../../stores/settings-access-extensions'

import { all as supportedLocales } from '@proj-airi/i18n'
import { isLive2DControlEnabled } from '@proj-airi/stage-ui-live2d/controls/policy'
import { useTheme } from '@proj-airi/ui'
import { toRaw } from 'vue'

import { useLlmStreamingControlStore } from '../../stores/ai/chat-llm/streaming-control'
import { useDisplayModelsStore } from '../../stores/display-models'
import { useAiriCardStore } from '../../stores/modules/airi-card'
import { useConsciousnessStore } from '../../stores/modules/consciousness'
import { useHearingStore } from '../../stores/modules/hearing'
import { useHomeAssistantStore } from '../../stores/modules/home-assistant'
import { useSpeechStore } from '../../stores/modules/speech'
import { useVisionStore } from '../../stores/modules/vision'
import { useWebSearchStore } from '../../stores/modules/web-search'
import { useProviderStore } from '../../stores/providers/provider'
import { useSettingsAccessExtensionsStore } from '../../stores/settings-access-extensions'
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

export interface HomeAssistantPolicyUpdate {
  enabled?: boolean
  exposureMode?: HomeAssistantExposureMode
  /** Replaces the list of the exposure mode: the allowed devices for `allow`, the blocked devices for `deny`. */
  entityIds?: string[]
}

export interface VisionUsageUpdate {
  useForChat?: boolean
  useForToolImages?: boolean
}

export interface HearingUpdate {
  inputMode?: HearingInputMode
  provider?: string
  model?: string
  autoSend?: boolean
  autoSendDelayMs?: number
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
  modules: {
    /** `connected` is true when the user saved an address and a token in the settings. Tools never see them. */
    homeAssistant: { enabled: boolean, connected: boolean, exposureMode: HomeAssistantExposureMode, allowedEntities: string[], deniedEntities: string[] }
    /** The search key stays private. `hasApiKey` only tells whether the user saved one. */
    webSearch: { enabled: boolean, hasApiKey: boolean }
    vision: { provider: string, model: string, useForChat: boolean, useForToolImages: boolean }
    hearing: { inputMode: HearingInputMode, provider: string, model: string, autoSend: boolean, autoSendDelayMs: number }
  }
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
  /** False when no character card is active. */
  renameCharacter: (name: string) => Promise<boolean>
  setHomeAssistant: (update: HomeAssistantPolicyUpdate) => void
  setWebSearchEnabled: (enabled: boolean) => void
  listVisionProviders: () => NamedOption[]
  /** Fetches the catalog first. Empty when the provider does not list models. */
  listVisionModels: (provider: string) => Promise<NamedOption[]>
  /** Saved on the active card, as the chat model is. False when no character card is active. */
  setVisionModel: (provider: string, model: string) => Promise<boolean>
  setVisionUsage: (update: VisionUsageUpdate) => void
  listTranscriptionProviders: () => NamedOption[]
  /** Fetches the catalog first. Empty when the provider does not list models. */
  listTranscriptionModels: (provider: string) => Promise<NamedOption[]>
  setHearing: (update: HearingUpdate) => void
  /** Present only in an app that owns the MCP server file, the desktop app. */
  mcpServers?: McpServersAccess
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
  const homeAssistant = useHomeAssistantStore()
  const webSearch = useWebSearchStore()
  const vision = useVisionStore()
  const hearing = useHearingStore()
  const extensions = useSettingsAccessExtensionsStore()

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
      modules: {
        homeAssistant: {
          enabled: homeAssistant.enabled,
          connected: homeAssistant.hasCredentials,
          exposureMode: homeAssistant.exposureMode,
          allowedEntities: [...homeAssistant.allowedEntities],
          deniedEntities: [...homeAssistant.deniedEntities],
        },
        webSearch: { enabled: webSearch.enabled, hasApiKey: webSearch.apiKey.trim().length > 0 },
        vision: { provider: vision.activeProvider, model: vision.activeModel, useForChat: vision.useForChat, useForToolImages: vision.useForToolImages },
        hearing: {
          inputMode: hearing.inputMode,
          provider: hearing.activeTranscriptionProvider,
          model: hearing.activeTranscriptionModel,
          autoSend: hearing.autoSendEnabled,
          autoSendDelayMs: hearing.autoSendDelay,
        },
      },
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
    renameCharacter: async (name) => {
      const card = cards.activeCard
      if (!card)
        return false

      return Boolean(await cards.updateCard(cards.activeCardId, { ...toRaw(card), name }))
    },
    setHomeAssistant: ({ enabled, exposureMode, entityIds }) => {
      if (enabled !== undefined)
        homeAssistant.enabled = enabled
      if (exposureMode !== undefined)
        homeAssistant.exposureMode = exposureMode
      // The list belongs to the mode in effect after the change above.
      if (entityIds !== undefined && homeAssistant.exposureMode === 'allow')
        homeAssistant.allowedEntities = entityIds
      if (entityIds !== undefined && homeAssistant.exposureMode === 'deny')
        homeAssistant.deniedEntities = entityIds
    },
    setWebSearchEnabled: (enabled) => {
      webSearch.enabled = enabled
    },
    listVisionProviders: () => providers.configuredVisionProvidersMetadata.map(toNamedOption),
    listVisionModels: async (provider) => {
      if (!providers.supportsModelListing(provider))
        return []

      await vision.loadModelsForProvider(provider)
      return (await vision.getModelsForProvider(provider)).map(model => ({ id: model.id, name: model.name }))
    },
    setVisionModel: async (provider, model) => Boolean(await cards.updateActiveCardVision({ provider, model })),
    setVisionUsage: ({ useForChat, useForToolImages }) => {
      if (useForChat !== undefined)
        vision.useForChat = useForChat
      if (useForToolImages !== undefined)
        vision.useForToolImages = useForToolImages
    },
    listTranscriptionProviders: () => providers.configuredTranscriptionProvidersMetadata.map(toNamedOption),
    listTranscriptionModels: async (provider) => {
      if (!providers.supportsModelListing(provider))
        return []

      await hearing.loadModelsForProvider(provider)
      return (await hearing.getModelsForProvider(provider)).map(model => ({ id: model.id, name: model.name }))
    },
    setHearing: ({ inputMode, provider, model, autoSend, autoSendDelayMs }) => {
      if (inputMode !== undefined)
        hearing.inputMode = inputMode
      if (provider !== undefined)
        hearing.activeTranscriptionProvider = provider
      if (model !== undefined)
        hearing.activeTranscriptionModel = model
      if (autoSend !== undefined)
        hearing.autoSendEnabled = autoSend
      if (autoSendDelayMs !== undefined)
        hearing.autoSendDelay = autoSendDelayMs
    },
    ...(extensions.mcpServers ? { mcpServers: extensions.mcpServers } : {}),
  }
}
