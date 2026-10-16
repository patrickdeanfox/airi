import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import type { StageToolDescriptor } from '@proj-airi/server-sdk'
import type { GenericSchema } from 'valibot'

import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { errorMessageFrom } from '@moeru/std'
import { toJsonSchema } from '@valibot/to-json-schema'
import { array, boolean, description, maxValue, minLength, minValue, nullable, number, object, optional, pipe, safeParse, string } from 'valibot'

import { resolveChannelUrl, resolveUserDataPath, StageChannel } from './channel'

/** Every tool name starts with this, so the tools stay distinct next to other MCP servers. */
const TOOL_PREFIX = 'airi_'
/** A larger tool result fills the context of the agent without more value. */
const MAX_RESULT_CHARACTERS = 25_000
/** The tool list must answer fast when the app is down, so the stage gets less time than a tool call. */
const LIST_TIMEOUT_MS = 5_000
// Terminal color codes in the app log only add noise for the agent.

const ANSI_PATTERN = /\x1B\[[0-9;]*m/g

interface StaticTool {
  definition: Tool
  input: GenericSchema
  /** Receives the input after `input` parsed it. `never` lets each tool declare its own parsed shape. */
  run: (input: never) => Promise<CallToolResult>
}

function jsonSchemaOf(schema: GenericSchema) {
  return toJsonSchema(schema) as Tool['inputSchema']
}

function succeeded(structured: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }], structuredContent: structured }
}

function failed(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] }
}

async function latestLogFile(): Promise<string | undefined> {
  const directory = join(resolveUserDataPath(), 'logs')
  const names = await readdir(directory).catch(() => [])
  const logs = await Promise.all(names.filter(name => name.endsWith('.log')).map(async (name) => {
    const path = join(directory, name)
    return { path, modified: (await stat(path)).mtimeMs }
  }))
  return logs.sort((a, b) => b.modified - a.modified)[0]?.path
}

/** Shows a stage tool as an MCP tool. The stage owns the schema and validates the arguments again. */
function stageToolDefinition(tool: StageToolDescriptor): Tool {
  return {
    name: `${TOOL_PREFIX}${tool.name}`,
    description: tool.description,
    inputSchema: { ...tool.parameters, type: 'object' },
    annotations: {
      readOnlyHint: tool.annotations.readOnly,
      destructiveHint: tool.annotations.destructive,
      idempotentHint: tool.annotations.idempotent,
      openWorldHint: false,
    },
  }
}

/**
 * Creates the MCP server. It has two kinds of tools:
 *
 * - Static tools that this server runs: status, logs, and chat. They answer when the app is down.
 * - Stage tools that the running app owns, such as `airi_set_voice`. The list comes from the app on each `tools/list`.
 *
 * Call stack:
 *
 * tools/call
 *   -> static tool `run`
 *   -> {@link StageChannel.invokeTool}
 *     -> `tool:invoke:request` on the channel -> leader stage window -> settings tool
 */
export function createAiriMcpServer(channel = new StageChannel()) {
  const server = new Server(
    { name: 'airi-mcp-server', version: '0.1.0' },
    { capabilities: { tools: { listChanged: true } } },
  )
  // The last `tools/list` answer had no stage tools. A later call that reaches the app tells the client to list again.
  let listedWithoutStage = false

  async function noteStageReachable() {
    if (!listedWithoutStage)
      return
    listedWithoutStage = false
    await server.sendToolListChanged().catch(() => {})
  }

  const statusOutput = object({
    channelUrl: string(),
    reachable: boolean(),
    userDataPath: string(),
    latestLogFile: nullable(string()),
    stageTools: array(string()),
  })
  const logsInput = object({
    lines: optional(pipe(number(), minValue(1), maxValue(500), description('How many lines to return from the end of the log. Default 100.')), 100),
    filter: optional(pipe(string(), minLength(1), description('Return only lines that contain this text, case-insensitive. For example "error" or "[tool-bridge]".'))),
  })
  const logsOutput = object({ file: string(), lines: array(string()), truncated: boolean() })
  const sendInput = object({
    text: pipe(string(), minLength(1), description('The message, as if the user typed it in the chat.')),
    sessionId: optional(pipe(string(), description('A chat session ID. Default: the active session.'))),
    waitSeconds: optional(pipe(number(), minValue(5), maxValue(300), description('How long to wait for the reply. Default 90.')), 90),
  })
  const sendOutput = object({ reply: string() })

  const staticTools: StaticTool[] = [
    {
      definition: {
        name: `${TOOL_PREFIX}get_status`,
        title: 'AIRI status',
        description: 'Tells whether the AIRI desktop app answers on its channel, where its data and newest log file are, and which stage tools it offers. Call this first when another airi tool fails.',
        inputSchema: { type: 'object', properties: {} },
        outputSchema: jsonSchemaOf(statusOutput) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      input: object({}),
      run: async () => {
        const stageTools = await channel.listTools(LIST_TIMEOUT_MS).then(tools => tools.map(tool => `${TOOL_PREFIX}${tool.name}`)).catch(() => [])
        const reachable = stageTools.length > 0 || await channel.isReachable()
        if (reachable)
          await noteStageReachable()
        return succeeded({ channelUrl: resolveChannelUrl(), reachable, userDataPath: resolveUserDataPath(), latestLogFile: await latestLogFile() ?? null, stageTools })
      },
    },
    {
      definition: {
        name: `${TOOL_PREFIX}get_logs`,
        title: 'AIRI app logs',
        description: 'Returns the last lines of the newest AIRI desktop log, without color codes. Use it to find why a reply, a voice, or a setting change failed. It works when the app is down.',
        inputSchema: jsonSchemaOf(logsInput),
        outputSchema: jsonSchemaOf(logsOutput) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      input: logsInput,
      run: async ({ lines, filter }: { lines: number, filter?: string }) => {
        const file = await latestLogFile()
        if (!file)
          return failed(`No log file in ${join(resolveUserDataPath(), 'logs')}. The app has not run with this user data path.`)

        const needle = filter?.toLowerCase()
        const all = (await readFile(file, 'utf8')).replace(ANSI_PATTERN, '').split('\n').filter(line => line && (!needle || line.toLowerCase().includes(needle)))
        let selected = all.slice(-Math.floor(lines))
        let truncated = false
        // Keep the newest lines when the selection is too long.
        while (selected.length > 1 && selected.join('\n').length > MAX_RESULT_CHARACTERS) {
          selected = selected.slice(1)
          truncated = true
        }
        return succeeded({ file, lines: selected, truncated })
      },
    },
    {
      definition: {
        name: `${TOOL_PREFIX}send_message`,
        title: 'Talk to AIRI',
        description: 'Sends a chat message to the character as the user and returns her reply text. She also speaks and animates the reply in the app. The reply comes from the configured chat model.',
        inputSchema: jsonSchemaOf(sendInput),
        outputSchema: jsonSchemaOf(sendOutput) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      input: sendInput,
      run: async ({ text, sessionId, waitSeconds }: { text: string, sessionId?: string, waitSeconds: number }) => {
        const reply = await channel.sendMessage(text, { sessionId, waitSeconds })
        await noteStageReachable()
        return succeeded({ reply })
      },
    },
  ]

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const stageTools = await channel.listTools(LIST_TIMEOUT_MS).catch((error: unknown) => {
      console.error('[airi-mcp-server] Listed only the static tools:', errorMessageFrom(error))
      return undefined
    })
    listedWithoutStage = !stageTools
    return { tools: [...staticTools.map(tool => tool.definition), ...(stageTools ?? []).map(stageToolDefinition)] }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    try {
      const staticTool = staticTools.find(tool => tool.definition.name === name)
      if (staticTool) {
        const parsed = safeParse(staticTool.input, args ?? {})
        if (!parsed.success)
          return failed(`Invalid arguments: ${parsed.issues.map(issue => issue.message).join('. ')}`)
        return await staticTool.run(parsed.output as never)
      }

      if (!name.startsWith(TOOL_PREFIX))
        return failed(`Unknown tool "${name}". Every tool of this server starts with "${TOOL_PREFIX}".`)

      const response = await channel.invokeTool(name.slice(TOOL_PREFIX.length), args ?? {})
      await noteStageReachable()
      if ('error' in response) {
        // An unknown name usually means that the app restarted with other tools since the client listed them.
        const hint = response.error.startsWith('Unknown tool') ? ` Call ${TOOL_PREFIX}get_status to see the tools that the app offers now.` : ''
        return failed(`${response.error}${hint}`)
      }

      const result = typeof response.result === 'object' && response.result !== null && !Array.isArray(response.result)
        ? response.result as Record<string, unknown>
        : { result: response.result }
      // The settings tools refuse a bad value with `status: 'rejected'` and list the valid choices in the result.
      return result.status === 'rejected' ? { ...succeeded(result), isError: true } : succeeded(result)
    }
    catch (error) {
      return failed(errorMessageFrom(error) ?? `The tool "${name}" failed`)
    }
  })

  return server
}

/** Serves the MCP server on stdin and stdout. Logs go to stderr, because stdout carries the protocol. */
export async function startAiriMcpServer() {
  const server = createAiriMcpServer()
  await server.connect(new StdioServerTransport())
  console.error('[airi-mcp-server] Ready on stdio. Channel:', resolveChannelUrl())
}
