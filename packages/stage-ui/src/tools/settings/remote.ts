import type { StageToolAnnotations, StageToolDescriptor, ToolInvokeResponseEvent } from '@proj-airi/server-sdk'
import type { Tool } from '@xsai/shared-chat'

import { errorMessageFrom } from '@moeru/std'

/**
 * How each settings tool affects state, for callers outside the chat turn such as the MCP bridge.
 * A tool that is not in this map gets {@link UNKNOWN_TOOL_ANNOTATIONS}.
 */
const TOOL_ANNOTATIONS: Record<string, StageToolAnnotations> = {
  settings_get: { readOnly: true, destructive: false, idempotent: true },
  settings_list_options: { readOnly: true, destructive: false, idempotent: true },
  set_chat_model: { readOnly: false, destructive: false, idempotent: true },
  set_voice: { readOnly: false, destructive: false, idempotent: true },
  set_speech_volume: { readOnly: false, destructive: false, idempotent: true },
  set_display_model: { readOnly: false, destructive: false, idempotent: true },
  set_language: { readOnly: false, destructive: false, idempotent: true },
  set_appearance: { readOnly: false, destructive: false, idempotent: true },
  // It replaces the prompt text, and the old text is not kept.
  update_character_prompt: { readOnly: false, destructive: true, idempotent: true },
  expression_set: { readOnly: false, destructive: false, idempotent: true },
  expression_reset: { readOnly: false, destructive: false, idempotent: true },
  rename_character: { readOnly: false, destructive: false, idempotent: true },
  set_home_assistant: { readOnly: false, destructive: false, idempotent: true },
  set_web_search: { readOnly: false, destructive: false, idempotent: true },
  set_vision: { readOnly: false, destructive: false, idempotent: true },
  set_hearing: { readOnly: false, destructive: false, idempotent: true },
  mcp_servers_list: { readOnly: true, destructive: false, idempotent: true },
  // A local server runs a program on the host.
  mcp_server_add: { readOnly: false, destructive: true, idempotent: false },
  mcp_server_set_enabled: { readOnly: false, destructive: false, idempotent: true },
  // The entry is deleted from the file.
  mcp_server_remove: { readOnly: false, destructive: true, idempotent: true },
}

/** Without known behavior, a caller must treat the tool as one that can lose data. */
const UNKNOWN_TOOL_ANNOTATIONS: StageToolAnnotations = Object.freeze({ readOnly: false, destructive: true, idempotent: false })

/** Remote calls have no chat turn, so the tools get an empty message history. */
function remoteExecuteOptions(name: string): Parameters<Tool['execute']>[1] {
  return { messages: [], toolCallId: `remote:${name}` }
}

/** Describes the tools in the shape that `tool:list:response` carries. */
export function listToolDescriptors(tools: Tool[]): StageToolDescriptor[] {
  return tools.map(entry => ({
    name: entry.function.name,
    description: entry.function.description ?? '',
    parameters: entry.function.parameters,
    annotations: TOOL_ANNOTATIONS[entry.function.name] ?? UNKNOWN_TOOL_ANNOTATIONS,
  }))
}

/**
 * Validates the arguments and runs one tool, for `tool:invoke:request`.
 *
 * It never throws. An unknown name, invalid arguments, and a failed run all return `{ name, error }`.
 */
export async function invokeTool(tools: Tool[], name: string, args: unknown): Promise<ToolInvokeResponseEvent> {
  const entry = tools.find(candidate => candidate.function.name === name)
  if (!entry)
    return { name, error: `Unknown tool "${name}". Known tools: ${tools.map(candidate => candidate.function.name).join(', ')}` }

  try {
    const validation = entry.validate ? await entry.validate(args ?? {}) : { value: args ?? {} }
    if (validation.issues)
      return { name, error: `Invalid arguments: ${validation.issues.map(issue => issue.message).join('. ')}` }

    return { name, result: await entry.execute(validation.value, remoteExecuteOptions(name)) }
  }
  catch (error) {
    return { name, error: errorMessageFrom(error) ?? `The tool "${name}" failed` }
  }
}
