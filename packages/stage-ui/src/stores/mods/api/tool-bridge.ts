import type { WebSocketBaseEvent } from '@proj-airi/server-sdk'

import { SETTINGS_TOOLS_FLAG } from '../../../libs/feature-flags'
import { createSettingsTools } from '../../../tools/settings'
import { createSettingsAccess } from '../../../tools/settings/access'
import { invokeTool, listToolDescriptors } from '../../../tools/settings/remote'
import { useFeatureFlagsStore } from '../../feature-flags'
import { useModsServerChannelStore } from './channel-server'

/**
 * Answers `tool:list:request` and `tool:invoke:request` from channel modules, such as the MCP bridge for Claude Code,
 * with the same settings tools that the character calls in a chat turn.
 *
 * Every stage window holds a channel connection and receives each request. Only the window for which `isLeader`
 * returns true answers, because the tools write state that the leader owns. A request from a connection that
 * announced no module is ignored, as for `asset:get:request`.
 *
 * Returns a function that removes both listeners.
 */
export function startStageToolBridge(isLeader: () => boolean): () => void {
  const serverChannelStore = useModsServerChannelStore()
  const featureFlags = useFeatureFlagsStore()

  // The tools are built for each request, as for each chat turn, so they read the current stores.
  // With the settings tools flag off, no tool is reachable.
  async function currentTools() {
    if (!featureFlags.isEnabled(SETTINGS_TOOLS_FLAG.key))
      return []
    return createSettingsTools(createSettingsAccess())
  }

  /** The requesting peer, or undefined when this window must not answer. */
  function requesterOf(event: WebSocketBaseEvent<string, unknown>) {
    if (!isLeader())
      return undefined
    // A client can claim any `metadata.source`. The server names the sending connection, so only that is trusted.
    const sender = event.metadata.sender
    if (!sender?.modules.length) {
      console.warn('[tool-bridge] Ignored a tool request from a connection that announced no module')
      return undefined
    }
    return sender
  }

  const stopList = serverChannelStore.onEvent('tool:list:request', async (event) => {
    const sender = requesterOf(event)
    if (!sender)
      return

    serverChannelStore.send({
      type: 'tool:list:response',
      data: { tools: listToolDescriptors(await currentTools()) },
      metadata: { event: { parentId: event.metadata.event.id } },
      route: { destinations: [`peer:${sender.peerId}`] },
    })
  })

  const stopInvoke = serverChannelStore.onEvent('tool:invoke:request', async (event) => {
    const sender = requesterOf(event)
    if (!sender)
      return

    const { name, args } = event.data
    console.info(`[tool-bridge] Module ${sender.modules.join(', ')} (peer ${sender.peerId}) runs ${name}`)
    serverChannelStore.send({
      type: 'tool:invoke:response',
      data: await invokeTool(await currentTools(), name, args),
      metadata: { event: { parentId: event.metadata.event.id } },
      route: { destinations: [`peer:${sender.peerId}`] },
    })
  })

  return () => {
    stopList()
    stopInvoke()
  }
}
