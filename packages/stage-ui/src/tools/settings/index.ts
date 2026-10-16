import type { Tool } from '@xsai/shared-chat'

import type { McpServersAccess } from '../../stores/settings-access-extensions'
import type { DarkMode, NamedOption, SettingsAccess } from './access'

import { errorMessageFrom } from '@moeru/std'
import { tool } from '@xsai/tool'
import { array, boolean, description, maxValue, minLength, minValue, number, object, optional, picklist, pipe, string } from 'valibot'

// `createSettingsAccess` stays in `./access`: it binds the stores, which the tools and their tests must not load.
export type { SettingsAccess, SettingsSnapshot } from './access'

/** Listing more choices than this makes the tool result too long for the model to use well. */
const MAX_LISTED_OPTIONS = 60

const listAreas = ['chat_models', 'voices', 'display_models', 'languages', 'expressions', 'vision_models', 'transcription_models'] as const
const exposureModes = ['all', 'allow', 'deny'] as const
const inputModes = ['always-on', 'push-to-talk', 'wake-word'] as const
/** The hearing settings page offers the same range for the auto-send delay. */
const MAX_AUTO_SEND_DELAY_MS = 10_000
const darkModes: readonly DarkMode[] = ['light', 'dark', 'auto']

function rejected(reason: string, extra: Record<string, unknown> = {}) {
  return { status: 'rejected' as const, reason, ...extra }
}

function rejectedFrom(error: unknown, fallback: string) {
  return rejected(errorMessageFrom(error) ?? fallback)
}

function limited<T>(options: T[]) {
  return options.slice(0, MAX_LISTED_OPTIONS)
}

/** Matches an exact id first, then a case-insensitive name, so the model can pass what the user said. */
function findOption<T extends NamedOption>(options: T[], query: string): T | undefined {
  const exact = options.find(option => option.id === query)
  if (exact)
    return exact

  const normalized = query.trim().toLowerCase()
  return options.find(option => option.id.toLowerCase() === normalized || option.name.toLowerCase() === normalized)
}

/** Matches a plain string list the same way as {@link findOption}. */
function findName(names: string[], query: string): string | undefined {
  const normalized = query.trim().toLowerCase()
  return names.find(name => name === query) ?? names.find(name => name.toLowerCase() === normalized)
}

async function createSettingsGetTool(access: SettingsAccess): Promise<Tool> {
  return tool({
    name: 'settings_get',
    description: [
      'Read the current settings: the chat provider and model, the speech provider, model and voice, the speech volume and mute state,',
      'the displayed model, the language, the theme hue and dark mode, the Live2D expressions you can use,',
      'and the modules: Home Assistant, web search, vision and hearing.',
      'Call it before you change a setting, and when the user asks what is set.',
    ].join(' '),
    parameters: object({}),
    execute: async () => {
      try {
        return { status: 'ok' as const, settings: access.snapshot() }
      }
      catch (error) {
        return rejectedFrom(error, 'Settings could not be read')
      }
    },
  })
}

async function createSettingsListOptionsTool(access: SettingsAccess): Promise<Tool> {
  return tool({
    name: 'settings_list_options',
    description: [
      'List the values a setting accepts. Call it when the user names something you cannot match, or asks what is available.',
      'Areas: chat_models (give provider to list its models, omit it to list the configured chat providers),',
      'voices (provider defaults to the active speech provider), display_models, languages, expressions,',
      'vision_models and transcription_models (give provider to list its models, omit it to list the configured providers).',
    ].join(' '),
    parameters: object({
      area: pipe(picklist(listAreas), description('The setting to list values for.')),
      provider: optional(pipe(string(), description('A provider id from the providers list. Used by chat_models and voices.'))),
      model: optional(pipe(string(), description('A speech model id. Some providers list voices per model.'))),
    }),
    execute: async ({ area, provider, model }) => {
      try {
        switch (area) {
          case 'chat_models': {
            const providers = access.listChatProviders()
            if (!provider)
              return { status: 'ok' as const, area, providers, hint: 'Call again with a provider id to list its models.' }
            if (!findOption(providers, provider))
              return rejected(`Chat provider "${provider}" is not configured`, { providers })
            if (!access.supportsModelListing(provider))
              return { status: 'ok' as const, area, provider, models: [], hint: 'This provider accepts any model id. Ask the user for the exact id.' }
            return { status: 'ok' as const, area, provider, models: limited(await access.listChatModels(provider)) }
          }
          case 'voices': {
            const providers = access.listSpeechProviders()
            const current = access.snapshot().speech
            const providerId = provider ?? current.provider
            if (!findOption(providers, providerId))
              return rejected(`Speech provider "${providerId}" is not configured`, { providers })
            const modelId = model ?? (providerId === current.provider ? current.model : undefined)
            return { status: 'ok' as const, area, provider: providerId, model: modelId ?? null, voices: limited(await access.listVoices(providerId, modelId)) }
          }
          case 'display_models':
            return { status: 'ok' as const, area, models: limited(access.listDisplayModels()) }
          case 'languages':
            return { status: 'ok' as const, area, languages: access.listLanguages() }
          case 'expressions': {
            const live2d = access.snapshot().live2d
            return { status: 'ok' as const, area, active: live2d.active, expressions: live2d.enabledExpressions }
          }
          case 'vision_models':
          case 'transcription_models': {
            const providers = area === 'vision_models' ? access.listVisionProviders() : access.listTranscriptionProviders()
            if (!provider)
              return { status: 'ok' as const, area, providers, hint: 'Call again with a provider id to list its models.' }
            const option = findOption(providers, provider)
            if (!option)
              return rejected(`Provider "${provider}" is not configured`, { providers })
            const models = area === 'vision_models' ? await access.listVisionModels(option.id) : await access.listTranscriptionModels(option.id)
            return { status: 'ok' as const, area, provider: option.id, models: limited(models), ...(models.length === 0 && { hint: 'This provider accepts any model id. Ask the user for the exact id.' }) }
          }
        }
      }
      catch (error) {
        return rejectedFrom(error, 'Options could not be listed')
      }
    },
  })
}

async function createSetChatModelTool(access: SettingsAccess): Promise<Tool> {
  return tool({
    name: 'set_chat_model',
    description: [
      'Switch the chat provider and model that generate your replies, when the user asks for it.',
      'Use ids from settings_list_options. The change applies from the next turn and is saved on your character card.',
    ].join(' '),
    parameters: object({
      provider: pipe(string(), minLength(1), description('The chat provider id.')),
      model: pipe(string(), minLength(1), description('The model id for that provider.')),
    }),
    execute: async ({ provider, model }) => {
      try {
        const providers = access.listChatProviders()
        const providerOption = findOption(providers, provider)
        if (!providerOption)
          return rejected(`Chat provider "${provider}" is not configured`, { providers })

        let modelId = model
        if (access.supportsModelListing(providerOption.id)) {
          const models = await access.listChatModels(providerOption.id)
          const modelOption = findOption(models, model)
          if (!modelOption)
            return rejected(`Model "${model}" is not available for ${providerOption.name}`, { models: limited(models) })
          modelId = modelOption.id
        }

        if (!await access.setChatModel(providerOption.id, modelId))
          return rejected('No active character card to save the chat model on')

        return { status: 'saved' as const, provider: providerOption.id, model: modelId }
      }
      catch (error) {
        return rejectedFrom(error, 'The chat model was not changed')
      }
    },
  })
}

async function createSetVoiceTool(access: SettingsAccess): Promise<Tool> {
  return tool({
    name: 'set_voice',
    description: [
      'Change the voice you speak with, when the user asks for it. Give the voice id or its exact name from settings_list_options.',
      'Provider and model default to the active speech provider and model. The change is saved on your character card.',
    ].join(' '),
    parameters: object({
      voice: pipe(string(), minLength(1), description('The voice id or its name.')),
      provider: optional(pipe(string(), description('A speech provider id. Defaults to the active one.'))),
      model: optional(pipe(string(), description('A speech model id. Defaults to the active one when the provider is unchanged.'))),
    }),
    execute: async ({ voice, provider, model }) => {
      try {
        const providers = access.listSpeechProviders()
        const current = access.snapshot().speech
        const providerOption = findOption(providers, provider ?? current.provider)
        if (!providerOption)
          return rejected(`Speech provider "${provider ?? current.provider}" is not configured`, { providers })

        // A different provider needs its own model, so the active model is only reused for the active provider.
        const modelId = model ?? (providerOption.id === current.provider ? current.model : '')
        const voices = await access.listVoices(providerOption.id, modelId || undefined)
        const voiceOption = findOption(voices, voice)
        if (!voiceOption)
          return rejected(`Voice "${voice}" is not available for ${providerOption.name}`, { voices: limited(voices) })

        if (!await access.setVoice(providerOption.id, modelId, voiceOption.id))
          return rejected('No active character card to save the voice on')

        return { status: 'saved' as const, provider: providerOption.id, model: modelId, voice: voiceOption.id, voiceName: voiceOption.name }
      }
      catch (error) {
        return rejectedFrom(error, 'The voice was not changed')
      }
    },
  })
}

async function createSetSpeechVolumeTool(access: SettingsAccess): Promise<Tool> {
  return tool({
    name: 'set_speech_volume',
    description: 'Change how loud you speak, from 0 (silent) to 1 (full), or mute and unmute your voice. Give at least one of the two.',
    parameters: object({
      volume: optional(pipe(number(), minValue(0), maxValue(1), description('Playback volume from 0 to 1.'))),
      muted: optional(pipe(boolean(), description('True silences speech, false restores it.'))),
    }),
    execute: async ({ volume, muted }) => {
      try {
        if (volume === undefined && muted === undefined)
          return rejected('Give a volume, a muted value, or both')

        if (volume !== undefined)
          access.setSpeechVolume(volume)
        if (muted !== undefined)
          access.setSpeechMuted(muted)

        const speech = access.snapshot().speech
        return { status: 'saved' as const, volume: speech.volume, muted: speech.muted }
      }
      catch (error) {
        return rejectedFrom(error, 'The speech volume was not changed')
      }
    },
  })
}

async function createSetDisplayModelTool(access: SettingsAccess): Promise<Tool> {
  return tool({
    name: 'set_display_model',
    description: [
      'Switch the model shown on the stage (Live2D, VRM, MMD, Spine or Tachie), when the user asks for it.',
      'Give the id or the exact name from settings_list_options. The choice is saved on your character card.',
    ].join(' '),
    parameters: object({
      model: pipe(string(), minLength(1), description('The display model id or its name.')),
    }),
    execute: async ({ model }) => {
      try {
        const models = access.listDisplayModels()
        const option = findOption(models, model)
        if (!option)
          return rejected(`Display model "${model}" is not imported`, { models: limited(models) })

        if (!await access.setDisplayModel(option.id))
          return rejected('The display model could not be selected for the active character')

        return { status: 'saved' as const, model: option.id, name: option.name, format: option.format }
      }
      catch (error) {
        return rejectedFrom(error, 'The display model was not changed')
      }
    },
  })
}

async function createSetLanguageTool(access: SettingsAccess): Promise<Tool> {
  return tool({
    name: 'set_language',
    description: 'Change the language of the app interface, when the user asks for it. Give a locale code such as en or ja, or the language name.',
    parameters: object({
      language: pipe(string(), minLength(1), description('A locale code or language name from settings_list_options.')),
    }),
    execute: async ({ language }) => {
      try {
        const languages = access.listLanguages().map(option => ({ id: option.code, name: option.name }))
        const option = findOption(languages, language)
        if (!option)
          return rejected(`Language "${language}" is not supported`, { languages })

        access.setLanguage(option.id)
        return { status: 'saved' as const, language: option.id, name: option.name }
      }
      catch (error) {
        return rejectedFrom(error, 'The language was not changed')
      }
    },
  })
}

async function createSetAppearanceTool(access: SettingsAccess): Promise<Tool> {
  return tool({
    name: 'set_appearance',
    description: [
      'Change the look of the app: the accent hue in degrees (0 red, 120 green, 220 blue, 300 purple) and the dark mode.',
      'Give at least one of the two.',
    ].join(' '),
    parameters: object({
      hue: optional(pipe(number(), minValue(0), maxValue(360), description('Accent color hue from 0 to 360 degrees.'))),
      darkMode: optional(pipe(picklist(darkModes), description('light, dark, or auto to follow the system.'))),
    }),
    execute: async ({ hue, darkMode }) => {
      try {
        if (hue === undefined && darkMode === undefined)
          return rejected('Give a hue, a dark mode, or both')

        if (hue !== undefined)
          access.setThemeHue(hue)
        if (darkMode !== undefined)
          access.setDarkMode(darkMode)

        return { status: 'saved' as const, theme: access.snapshot().theme }
      }
      catch (error) {
        return rejectedFrom(error, 'The appearance was not changed')
      }
    },
  })
}

async function createUpdateCharacterPromptTool(access: SettingsAccess): Promise<Tool> {
  return tool({
    name: 'update_character_prompt',
    description: [
      'Rewrite parts of your own character card: the system prompt, the personality, or the scenario.',
      'Use it only when the user explicitly asks to change who you are or the setting you are in. Each field you give replaces that field completely.',
      'The change applies from the next turn.',
    ].join(' '),
    parameters: object({
      systemPrompt: optional(pipe(string(), description('The complete new system prompt.'))),
      personality: optional(pipe(string(), description('The complete new personality text.'))),
      scenario: optional(pipe(string(), description('The complete new scenario text.'))),
    }),
    execute: async ({ systemPrompt, personality, scenario }) => {
      try {
        const fields = {
          ...(systemPrompt !== undefined && { systemPrompt }),
          ...(personality !== undefined && { personality }),
          ...(scenario !== undefined && { scenario }),
        }
        const updated = Object.keys(fields)
        if (updated.length === 0)
          return rejected('Give at least one of systemPrompt, personality or scenario')

        if (!await access.updateCharacterPrompt(fields))
          return rejected('No active character card to update')

        return { status: 'saved' as const, updated }
      }
      catch (error) {
        return rejectedFrom(error, 'The character card was not changed')
      }
    },
  })
}

async function createExpressionSetTool(access: SettingsAccess): Promise<Tool> {
  return tool({
    name: 'expression_set',
    description: [
      'Show one of your Live2D expressions on the stage, for example when the user asks to see it.',
      'Expressions are the toggles of the loaded model, such as an outfit colour or a face preset. They are not emotions: happy, sad or neutral come from your act tokens, not from this tool.',
      'Give the exact name from settings_list_options with area expressions. Without a duration the expression stays until expression_reset.',
    ].join(' '),
    parameters: object({
      name: pipe(string(), minLength(1), description('The expression name.')),
      duration: optional(pipe(number(), minValue(0.1), maxValue(600), description('Seconds to hold the expression before it resets.'))),
    }),
    execute: async ({ name, duration }) => {
      try {
        const live2d = access.snapshot().live2d
        if (!live2d.active)
          return rejected('No Live2D model is shown on the stage')

        const expression = findName(live2d.enabledExpressions, name)
        if (!expression)
          return rejected(`Expression "${name}" is not available`, { expressions: live2d.enabledExpressions })

        const payload = { expression: { name: expression, ...(duration !== undefined && { duration }) } }
        if (!await access.dispatchAct(payload))
          return rejected('The stage did not run the expression')

        return { status: 'saved' as const, expression, duration: duration ?? null }
      }
      catch (error) {
        return rejectedFrom(error, 'The expression was not shown')
      }
    },
  })
}

async function createExpressionResetTool(access: SettingsAccess): Promise<Tool> {
  return tool({
    name: 'expression_reset',
    description: 'Clear every Live2D expression you set with expression_set, so your face returns to its default.',
    parameters: object({}),
    execute: async () => {
      try {
        if (!access.snapshot().live2d.active)
          return rejected('No Live2D model is shown on the stage')

        if (!await access.dispatchAct({ expression: null }))
          return rejected('The stage did not reset the expression')

        return { status: 'saved' as const }
      }
      catch (error) {
        return rejectedFrom(error, 'The expression was not reset')
      }
    },
  })
}

async function createRenameCharacterTool(access: SettingsAccess): Promise<Tool> {
  return tool({
    name: 'rename_character',
    description: 'Change the name of your character card, when the user asks for a new name. The new name shows from the next turn.',
    parameters: object({
      name: pipe(string(), minLength(1), description('The new character name.')),
    }),
    execute: async ({ name }) => {
      try {
        const trimmed = name.trim()
        if (!trimmed)
          return rejected('The name is empty')

        if (!await access.renameCharacter(trimmed))
          return rejected('No active character card to rename')

        return { status: 'saved' as const, name: trimmed }
      }
      catch (error) {
        return rejectedFrom(error, 'The character was not renamed')
      }
    },
  })
}

async function createSetHomeAssistantTool(access: SettingsAccess): Promise<Tool> {
  return tool({
    name: 'set_home_assistant',
    description: [
      'Turn the Home Assistant module on or off, and choose which devices you can reach:',
      'all of them, only an allowed list (allow), or all except a blocked list (deny).',
      'entityIds replaces the list of the chosen mode. The address and token stay in the settings page, and you cannot set them.',
    ].join(' '),
    parameters: object({
      enabled: optional(pipe(boolean(), description('True turns the module on.'))),
      exposureMode: optional(pipe(picklist(exposureModes), description('all, allow, or deny.'))),
      entityIds: optional(pipe(array(pipe(string(), minLength(1))), description('Entity ids for the allow or deny list, for example "light.kitchen".'))),
    }),
    execute: async ({ enabled, exposureMode, entityIds }) => {
      try {
        if (enabled === undefined && exposureMode === undefined && entityIds === undefined)
          return rejected('Give enabled, exposureMode, entityIds, or a mix')

        const mode = exposureMode ?? access.snapshot().modules.homeAssistant.exposureMode
        if (entityIds !== undefined && mode === 'all')
          return rejected('The mode "all" has no device list. Give exposureMode allow or deny with the list')

        access.setHomeAssistant({ enabled, exposureMode, entityIds })
        const state = access.snapshot().modules.homeAssistant
        return {
          status: 'saved' as const,
          ...state,
          ...(state.enabled && !state.connected && { hint: 'The module is on, but the user has not saved an address and token in the settings yet.' }),
        }
      }
      catch (error) {
        return rejectedFrom(error, 'The Home Assistant settings were not changed')
      }
    },
  })
}

async function createSetWebSearchTool(access: SettingsAccess): Promise<Tool> {
  return tool({
    name: 'set_web_search',
    description: 'Turn the web search module on or off. The search API key stays in the settings page, and you cannot set it.',
    parameters: object({
      enabled: pipe(boolean(), description('True turns web search on.')),
    }),
    execute: async ({ enabled }) => {
      try {
        access.setWebSearchEnabled(enabled)
        const state = access.snapshot().modules.webSearch
        return {
          status: 'saved' as const,
          enabled: state.enabled,
          ...(state.enabled && !state.hasApiKey && { hint: 'Web search is on, but it needs an API key that the user saves in the settings.' }),
        }
      }
      catch (error) {
        return rejectedFrom(error, 'Web search was not changed')
      }
    },
  })
}

async function createSetVisionTool(access: SettingsAccess): Promise<Tool> {
  return tool({
    name: 'set_vision',
    description: [
      'Change how you see images: the vision provider and model (saved on your character card),',
      'whether chat images go to the vision model, and whether tool images do. Give at least one value.',
    ].join(' '),
    parameters: object({
      provider: optional(pipe(string(), minLength(1), description('A vision provider id from settings_list_options with area vision_models.'))),
      model: optional(pipe(string(), minLength(1), description('The model id for that provider. Required with provider.'))),
      useForChat: optional(pipe(boolean(), description('True sends images in the chat to the vision model.'))),
      useForToolImages: optional(pipe(boolean(), description('True sends images from tools to the vision model.'))),
    }),
    execute: async ({ provider, model, useForChat, useForToolImages }) => {
      try {
        if (provider === undefined && model === undefined && useForChat === undefined && useForToolImages === undefined)
          return rejected('Give a provider and model, useForChat, useForToolImages, or a mix')

        if ((provider === undefined) !== (model === undefined))
          return rejected('Give provider and model together')

        if (provider !== undefined && model !== undefined) {
          const providers = access.listVisionProviders()
          const providerOption = findOption(providers, provider)
          if (!providerOption)
            return rejected(`Vision provider "${provider}" is not configured`, { providers })

          const models = await access.listVisionModels(providerOption.id)
          const modelOption = models.length > 0 ? findOption(models, model) : { id: model, name: model }
          if (!modelOption)
            return rejected(`Model "${model}" is not available for ${providerOption.name}`, { models: limited(models) })

          if (!await access.setVisionModel(providerOption.id, modelOption.id))
            return rejected('No active character card to save the vision model on')
        }

        access.setVisionUsage({ useForChat, useForToolImages })
        return { status: 'saved' as const, vision: access.snapshot().modules.vision }
      }
      catch (error) {
        return rejectedFrom(error, 'The vision settings were not changed')
      }
    },
  })
}

async function createSetHearingTool(access: SettingsAccess): Promise<Tool> {
  return tool({
    name: 'set_hearing',
    description: [
      'Change how you hear the user: the input mode (always-on, push-to-talk, or wake-word),',
      'the speech-to-text provider and model, and whether a transcript sends itself after a pause. Give at least one value.',
    ].join(' '),
    parameters: object({
      inputMode: optional(pipe(picklist(inputModes), description('always-on, push-to-talk, or wake-word.'))),
      provider: optional(pipe(string(), minLength(1), description('A transcription provider id from settings_list_options with area transcription_models.'))),
      model: optional(pipe(string(), minLength(1), description('The model id for the provider. Required with provider.'))),
      autoSend: optional(pipe(boolean(), description('True sends a transcript after the pause in autoSendDelayMs.'))),
      autoSendDelayMs: optional(pipe(number(), minValue(0), maxValue(MAX_AUTO_SEND_DELAY_MS), description('The pause before an automatic send, in milliseconds.'))),
    }),
    execute: async ({ inputMode, provider, model, autoSend, autoSendDelayMs }) => {
      try {
        if (inputMode === undefined && provider === undefined && model === undefined && autoSend === undefined && autoSendDelayMs === undefined)
          return rejected('Give inputMode, provider and model, autoSend, autoSendDelayMs, or a mix')

        if ((provider === undefined) !== (model === undefined))
          return rejected('Give provider and model together')

        let providerId: string | undefined
        let modelId: string | undefined
        if (provider !== undefined && model !== undefined) {
          const providers = access.listTranscriptionProviders()
          const providerOption = findOption(providers, provider)
          if (!providerOption)
            return rejected(`Transcription provider "${provider}" is not configured`, { providers })

          const models = await access.listTranscriptionModels(providerOption.id)
          const modelOption = models.length > 0 ? findOption(models, model) : { id: model, name: model }
          if (!modelOption)
            return rejected(`Model "${model}" is not available for ${providerOption.name}`, { models: limited(models) })

          providerId = providerOption.id
          modelId = modelOption.id
        }

        access.setHearing({ inputMode, provider: providerId, model: modelId, autoSend, autoSendDelayMs })
        return { status: 'saved' as const, hearing: access.snapshot().modules.hearing }
      }
      catch (error) {
        return rejectedFrom(error, 'The hearing settings were not changed')
      }
    },
  })
}

async function createMcpServerTools(mcpServers: McpServersAccess): Promise<Tool[]> {
  async function findServer(name: string) {
    const servers = await mcpServers.list()
    const match = findOption(servers.map(server => ({ ...server, id: server.name })), name)
    return { servers, match }
  }

  return Promise.all([
    tool({
      name: 'mcp_servers_list',
      description: 'List the MCP servers you can call tools from, with their transport, target and whether each is on.',
      parameters: object({}),
      execute: async () => {
        try {
          return { status: 'ok' as const, servers: await mcpServers.list() }
        }
        catch (error) {
          return rejectedFrom(error, 'The MCP servers could not be listed')
        }
      },
    }),
    tool({
      name: 'mcp_server_add',
      description: [
        'Add an MCP server, when the user asks for it. Give url for an HTTP server, or command and args for a local server.',
        'A local server runs a program on this computer, so add one only with a command the user gave you.',
        'Saving restarts all MCP servers.',
      ].join(' '),
      parameters: object({
        name: pipe(string(), minLength(1), description('A short unique name, for example "weather".')),
        url: optional(pipe(string(), minLength(1), description('The http or https URL of an HTTP server.'))),
        command: optional(pipe(string(), minLength(1), description('The program of a local server.'))),
        args: optional(pipe(array(string()), description('Arguments for the program.'))),
      }),
      execute: async ({ name, url, command, args }) => {
        try {
          if ((url === undefined) === (command === undefined))
            return rejected('Give exactly one of url or command')

          const { servers, match } = await findServer(name)
          if (match)
            return rejected(`An MCP server named "${match.name}" already exists`, { servers })

          await mcpServers.add({ name: name.trim(), url, command, args })
          return { status: 'saved' as const, servers: await mcpServers.list() }
        }
        catch (error) {
          return rejectedFrom(error, 'The MCP server was not added')
        }
      },
    }),
    tool({
      name: 'mcp_server_set_enabled',
      description: 'Turn one MCP server on or off. Saving restarts all MCP servers.',
      parameters: object({
        name: pipe(string(), minLength(1), description('The server name from mcp_servers_list.')),
        enabled: pipe(boolean(), description('True turns the server on.')),
      }),
      execute: async ({ name, enabled }) => {
        try {
          const { servers, match } = await findServer(name)
          if (!match)
            return rejected(`No MCP server named "${name}"`, { servers })

          await mcpServers.setEnabled(match.name, enabled)
          return { status: 'saved' as const, servers: await mcpServers.list() }
        }
        catch (error) {
          return rejectedFrom(error, 'The MCP server was not changed')
        }
      },
    }),
    tool({
      name: 'mcp_server_remove',
      description: 'Remove one MCP server, when the user asks for it. Saving restarts all MCP servers.',
      parameters: object({
        name: pipe(string(), minLength(1), description('The server name from mcp_servers_list.')),
      }),
      execute: async ({ name }) => {
        try {
          const { servers, match } = await findServer(name)
          if (!match)
            return rejected(`No MCP server named "${name}"`, { servers })

          await mcpServers.remove(match.name)
          return { status: 'saved' as const, servers: await mcpServers.list() }
        }
        catch (error) {
          return rejectedFrom(error, 'The MCP server was not removed')
        }
      },
    }),
  ])
}

/**
 * Creates the tools that let the character read and change settings during one chat turn.
 *
 * Every tool validates its input against the lists in `access` before it writes, and returns data for the character
 * to explain: `ok` with the values read, `saved` with what changed, or `rejected` with a reason and the valid choices.
 */
export async function createSettingsTools(access: SettingsAccess): Promise<Tool[]> {
  const tools = await Promise.all([
    createSettingsGetTool(access),
    createSettingsListOptionsTool(access),
    createSetChatModelTool(access),
    createSetVoiceTool(access),
    createSetSpeechVolumeTool(access),
    createSetDisplayModelTool(access),
    createSetLanguageTool(access),
    createSetAppearanceTool(access),
    createUpdateCharacterPromptTool(access),
    createExpressionSetTool(access),
    createExpressionResetTool(access),
    createRenameCharacterTool(access),
    createSetHomeAssistantTool(access),
    createSetWebSearchTool(access),
    createSetVisionTool(access),
    createSetHearingTool(access),
  ])
  // Only an app that owns the MCP server file provides this access, so other apps do not list these tools.
  return access.mcpServers ? [...tools, ...await createMcpServerTools(access.mcpServers)] : tools
}
