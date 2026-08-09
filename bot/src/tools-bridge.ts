import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { ChatCompletionTool } from 'openai/resources/chat/completions'
import { tools as supabaseTools } from '../../mcp-server/src/tools.js'

// Ponte tra i tool Supabase già scritti per il server MCP (mcp-server/src/tools.ts)
// e il function-calling nativo di OpenAI: stessa logica, nessuna duplicazione,
// nessun protocollo MCP di mezzo (il bot chiama gli handler direttamente).

export const openAiTools: ChatCompletionTool[] = supabaseTools.map((tool) => ({
  type: 'function',
  function: {
    name: tool.name,
    description: tool.description,
    parameters: zodToJsonSchema(z.object(tool.inputSchema)) as Record<string, unknown>,
  },
}))

export async function eseguiTool(name: string, argsJson: string): Promise<string> {
  const tool = supabaseTools.find((t) => t.name === name)
  if (!tool) {
    return `Errore: tool "${name}" inesistente.`
  }
  try {
    const rawArgs = argsJson ? JSON.parse(argsJson) : {}
    const parsedArgs = z.object(tool.inputSchema).parse(rawArgs)
    const result = await (tool.handler as (args: unknown) => Promise<unknown>)(parsedArgs)
    return JSON.stringify(result)
  } catch (err) {
    return `Errore: ${err instanceof Error ? err.message : String(err)}`
  }
}
