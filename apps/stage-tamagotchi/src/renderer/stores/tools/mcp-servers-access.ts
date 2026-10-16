import type { McpServerInput, McpServersAccess, McpServerSummary } from '@proj-airi/stage-ui/stores/settings-access-extensions'

import type { ElectronMcpConfigFile, ElectronMcpServerConfig } from '../../../shared/eventa'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'

import { electronMcpApplyAndRestart, electronMcpReadConfigText, electronMcpWriteConfigText } from '../../../shared/eventa'
import { electronMcpServerConfigSchema, isHttpServerConfig, parseElectronMcpConfigText } from '../../../shared/mcp-config'

function toSummary(name: string, config: ElectronMcpServerConfig): McpServerSummary {
  return isHttpServerConfig(config)
    ? { name, transport: 'http', enabled: config.enabled !== false, target: config.url }
    : { name, transport: 'stdio', enabled: config.enabled !== false, target: [config.command, ...(config.args ?? [])].join(' ') }
}

function toConfig(server: McpServerInput): ElectronMcpServerConfig {
  const draft = server.url !== undefined ? { url: server.url } : { command: server.command, ...(server.args?.length ? { args: server.args } : {}) }
  // The same schema validates the file in the main process, so a bad URL or an empty command fails here first.
  return electronMcpServerConfigSchema.parse(draft)
}

/**
 * Gives the settings tools read and write access to the character's MCP server file.
 *
 * Every write reads the file again, changes one entry, saves it, and restarts the servers, as the MCP settings page
 * does on save. Must run in a component setup scope, because it creates Electron invokes.
 */
export function createMcpServersAccess(): McpServersAccess {
  const readConfigText = useElectronEventaInvoke(electronMcpReadConfigText)
  const writeConfigText = useElectronEventaInvoke(electronMcpWriteConfigText)
  const applyAndRestart = useElectronEventaInvoke(electronMcpApplyAndRestart)

  async function readConfig(): Promise<ElectronMcpConfigFile> {
    return parseElectronMcpConfigText((await readConfigText()).text)
  }

  async function writeConfig(update: (servers: ElectronMcpConfigFile['mcpServers']) => ElectronMcpConfigFile['mcpServers']) {
    const config = await readConfig()
    const next: ElectronMcpConfigFile = { ...config, mcpServers: update({ ...config.mcpServers }) }
    await writeConfigText({ text: `${JSON.stringify(next, null, 2)}\n` })
    await applyAndRestart()
  }

  return {
    list: async () => Object.entries((await readConfig()).mcpServers).map(([name, config]) => toSummary(name, config)),
    add: server => writeConfig(servers => ({ ...servers, [server.name]: toConfig(server) })),
    setEnabled: (name, enabled) => writeConfig((servers) => {
      const current = servers[name]
      if (!current)
        throw new Error(`No MCP server named "${name}"`)
      // The settings page writes `enabled: false` for a disabled server and omits the field for an enabled one.
      const { enabled: _previous, ...rest } = current
      return { ...servers, [name]: enabled ? rest : { ...rest, enabled: false } }
    }),
    remove: name => writeConfig((servers) => {
      if (!servers[name])
        throw new Error(`No MCP server named "${name}"`)
      const { [name]: _removed, ...rest } = servers
      return rest
    }),
  }
}
