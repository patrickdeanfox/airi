import type { StageToolDescriptor, ToolInvokeResponseEvent, WebSocketEvents } from '@proj-airi/server-sdk'

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { env, platform } from 'node:process'

import { errorMessageFrom } from '@moeru/std'
import { Client } from '@proj-airi/server-sdk'

/** The module name that the stage logs for each tool call from this server. */
const MODULE_NAME = 'avatar:claude-code'
const DESKTOP_APP_NAME = '@proj-airi/stage-tamagotchi'

/**
 * Where the desktop app keeps its user data, the same directory as Electron `app.getPath('userData')`.
 * `APP_USER_DATA_PATH` overrides it, as it does for the app.
 */
export function resolveUserDataPath(): string {
  const override = env.APP_USER_DATA_PATH?.trim()
  if (override)
    return override
  if (platform === 'darwin')
    return join(homedir(), 'Library', 'Application Support', DESKTOP_APP_NAME)
  if (platform === 'win32')
    return join(env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), DESKTOP_APP_NAME)
  return join(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), DESKTOP_APP_NAME)
}

export function resolveChannelUrl(): string {
  return env.AIRI_CHANNEL_URL ?? `ws://127.0.0.1:${env.SERVER_CHANNEL_PORT ?? '6121'}/ws`
}

/** The error that a tool shows when the app does not answer, with the next step for the agent. */
export class StageUnavailableError extends Error {
  constructor(reason: string) {
    super(`AIRI does not answer at ${resolveChannelUrl()} (${reason}). Start the desktop app, then try again.`)
  }
}

/** Text of an assistant message whose content is a string or an array of parts. */
function messageText(message: unknown): string {
  const content = (message as { content?: unknown } | undefined)?.content
  if (typeof content === 'string')
    return content
  if (!Array.isArray(content))
    return ''
  return content
    .filter((part): part is { type: 'text', text: string } => part?.type === 'text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('')
}

/**
 * One connection to the stage channel server, opened on the first call and kept while it works.
 *
 * State: `client` holds the open connection, or undefined. A failed connect or request closes the client and clears it,
 * so the next call connects again. This covers an app restart between calls.
 */
export class StageChannel {
  private client: Client | undefined

  /** True when the channel server accepts a connection now. It never throws. */
  async isReachable(): Promise<boolean> {
    try {
      await this.connected()
      return true
    }
    catch {
      return false
    }
  }

  async listTools(timeoutMs?: number): Promise<StageToolDescriptor[]> {
    return this.withClient(client => client.listStageTools({ timeoutMs }))
  }

  async invokeTool(name: string, args: unknown): Promise<ToolInvokeResponseEvent> {
    return this.withClient(client => client.invokeStageTool(name, args))
  }

  /**
   * Sends a chat message as the user and returns the text of the reply.
   *
   * The stage does not tag a reply with the input that caused it. So the first `output:gen-ai:chat:complete` after the
   * send counts as the reply, the same rule as `scripts/airi-say.mjs` in the workspace.
   */
  async sendMessage(text: string, options: { sessionId?: string, waitSeconds: number }): Promise<string> {
    return this.withClient(async (client) => {
      let lastText = ''
      const { promise, resolve, reject } = Promise.withResolvers<string>()
      const timer = setTimeout(() => reject(new Error(`No reply within ${options.waitSeconds} s. The chat model can be slow or not configured. Read the app logs.`)), options.waitSeconds * 1000)
      const stopMessage = client.onEvent('output:gen-ai:chat:message', (event) => {
        lastText = messageText(event.data.message) || lastText
      })
      const stopComplete = client.onEvent('output:gen-ai:chat:complete', (event) => {
        resolve((messageText(event.data.message) || lastText).trim())
      })

      try {
        const data: WebSocketEvents['input:text'] = { text, ...(options.sessionId ? { overrides: { sessionId: options.sessionId } } : {}) }
        client.sendOrThrow({ type: 'input:text', data })
        return await promise
      }
      finally {
        clearTimeout(timer)
        stopMessage()
        stopComplete()
      }
    })
  }

  close(): void {
    this.client?.close()
    this.client = undefined
  }

  private async withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
    const client = await this.connected()
    try {
      return await run(client)
    }
    catch (error) {
      // A request that times out often means that the app stopped. Reconnect on the next call.
      this.close()
      throw error
    }
  }

  private async connected(): Promise<Client> {
    if (this.client)
      return this.client

    const client = new Client({
      url: resolveChannelUrl(),
      name: MODULE_NAME,
      token: await readChannelToken(),
      autoConnect: false,
      autoReconnect: false,
      possibleEvents: ['tool:list:response', 'tool:invoke:response', 'output:gen-ai:chat:message', 'output:gen-ai:chat:complete'],
    })
    try {
      await client.connect()
    }
    catch (error) {
      client.close()
      // A refused socket rejects with an event that has no message, so an empty message also selects the fallback.
      throw new StageUnavailableError(errorMessageFrom(error) || 'connection refused')
    }
    this.client = client
    return client
  }
}

/** The app writes the channel token here. Without the file, the server can run without a token. */
async function readChannelToken(): Promise<string | undefined> {
  try {
    const config = JSON.parse(await readFile(join(resolveUserDataPath(), 'server-channel-config.json'), 'utf8')) as { authToken?: unknown }
    return typeof config.authToken === 'string' && config.authToken ? config.authToken : undefined
  }
  catch {
    return undefined
  }
}
