import type { ExecutableTool } from '@proj-airi/stage-ui/stores/ai/chat-llm/tools'

import { useExpressionStore } from '@proj-airi/stage-ui-live2d/stores/expression-store'
import { expressionTools } from '@proj-airi/stage-ui-live2d/tools/expression-tools'
import { useLlmToolsStore } from '@proj-airi/stage-ui/stores/ai/chat-llm/tools'
import { defineStore } from 'pinia'
import { watch } from 'vue'

/** Expression tools the model can call. Save and reset stay with the user in settings. */
const exposedToolNames = ['expression_set', 'expression_get', 'expression_toggle']

/**
 * Registers the Live2D expression tools while the loaded model exposes expressions to the LLM.
 *
 * The expression store lives in the main Stage renderer, which is also the leader. Call {@link refresh} only there.
 */
export const useTamagotchiLive2dExpressionToolsStore = defineStore('tamagotchi-live2d-expression-tools', () => {
  const llmToolsStore = useLlmToolsStore()
  const expressionStore = useExpressionStore()
  const toolIdPrefix = 'live2d-expression:'
  let watching = false

  function registeredToolIds() {
    return llmToolsStore.tools
      .filter(tool => tool.id.startsWith(toolIdPrefix))
      .map(tool => tool.id)
  }

  function hasExposedExpressions() {
    return [...expressionStore.expressionGroups.keys()].some(name => expressionStore.isExposedToLlm(name))
  }

  async function sync() {
    llmToolsStore.removeToolsByIds(...registeredToolIds())
    if (!hasExposedExpressions())
      return

    const tools = (await expressionTools()).filter(tool => exposedToolNames.includes(tool.function.name))
    llmToolsStore.addTools(...tools.map(tool => ({
      ...tool,
      id: `${toolIdPrefix}${tool.function.name}`,
    } satisfies ExecutableTool)))
  }

  async function refresh() {
    if (!watching) {
      watching = true
      watch(
        () => [expressionStore.modelId, expressionStore.llmMode, expressionStore.expressionGroups, expressionStore.llmExposed],
        () => void sync().catch(error => console.warn('[live2d-expression-tools] Failed to sync tools:', error)),
      )
    }
    await sync()
  }

  return { refresh }
}, {
  synced: {
    actions: ['refresh'],
    state: false,
  },
})
