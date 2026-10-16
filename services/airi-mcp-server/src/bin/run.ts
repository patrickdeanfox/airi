import process from 'node:process'

import { startAiriMcpServer } from '../server'

/**
 * Runs the AIRI MCP server on stdio, for an MCP client such as Claude Code.
 *
 * Call stack:
 *
 * main
 *   -> {@link startAiriMcpServer}
 *     -> createAiriMcpServer -> StdioServerTransport
 */
async function main() {
  await startAiriMcpServer()
}

main().catch((error: unknown) => {
  console.error('[airi-mcp-server] Failed to start:', error)
  process.exitCode = 1
})
