import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { env } from './env.js'
import { tools } from './tools.js'

const server = new McpServer({
  name: 'benessere-mcp-server',
  version: '0.1.0',
})

for (const tool of tools) {
  server.tool(tool.name, tool.description, tool.inputSchema, async (args: Record<string, unknown>) => {
    try {
      const result = await tool.handler(args as never)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      }
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Errore: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      }
    }
  })
}

const transport = new StdioServerTransport()
await server.connect(transport)
console.error(`[benessere-mcp-server] avviato per l'agente "${env.agentName}"`)
