import { defineStore } from 'pinia'
import { shallowRef } from 'vue'

/** One MCP server of the character, without its headers or environment, which can hold credentials. */
export interface McpServerSummary {
  name: string
  transport: 'stdio' | 'http'
  enabled: boolean
  /** The command for a stdio server, or the URL for an HTTP server. */
  target: string
}

/** A new MCP server. Give `url` for an HTTP server, or `command` with optional `args` for a stdio server. */
export interface McpServerInput {
  name: string
  url?: string
  command?: string
  args?: string[]
}

/**
 * Reads and changes the MCP servers that the character calls.
 *
 * Only the desktop app owns the server file, so it provides this access. Every write saves the file and restarts the
 * servers. A failed write throws with the reason.
 */
export interface McpServersAccess {
  list: () => Promise<McpServerSummary[]>
  add: (server: McpServerInput) => Promise<void>
  setEnabled: (name: string, enabled: boolean) => Promise<void>
  remove: (name: string) => Promise<void>
}

/**
 * Holds settings access that only an app can provide, for the settings tools in this package.
 *
 * The leader window of an app registers its access at startup. The settings tools read the store on each build, so a
 * tool for an access that no app registered is not listed.
 */
export const useSettingsAccessExtensionsStore = defineStore('settings-access-extensions', () => {
  const mcpServers = shallowRef<McpServersAccess>()

  /** Returns a function that removes the access again, if no later registration replaced it. */
  function registerMcpServers(access: McpServersAccess): () => void {
    mcpServers.value = access
    return () => {
      if (mcpServers.value === access)
        mcpServers.value = undefined
    }
  }

  return { mcpServers, registerMcpServers }
})
