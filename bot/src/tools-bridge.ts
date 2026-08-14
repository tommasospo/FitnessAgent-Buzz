import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { ChatCompletionTool } from 'openai/resources/chat/completions'
import { tools as supabaseTools } from '../../mcp-server/src/tools.js'

// Ponte tra i tool Supabase già scritti per il server MCP (mcp-server/src/tools.ts)
// e il function-calling nativo di OpenAI: stessa logica, nessuna duplicazione,
// nessun protocollo MCP di mezzo (il bot chiama gli handler direttamente).

// leggi_memoria_persona/salva_memoria_persona prendono un pubkey_persona in mcp-server (generico,
// riusabile fuori dal bot), ma verso l'LLM lo nascondiamo e lo iniettiamo qui col pubkey di chi sta
// scrivendo ORA: la cronologia che il modello vede mostra solo pubkey troncate a 8 caratteri, non
// abbastanza per ricostruire un pubkey vero — lasciarglielo compilare vorrebbe dire quasi certamente
// un pubkey sbagliato/allucinato, quindi il binding lo fa il codice, mai il modello.
const TOOL_MEMORIA_LETTURA = 'leggi_memoria_persona'
const TOOL_MEMORIA_SCRITTURA = 'salva_memoria_persona'
const TOOL_CON_PUBKEY_IMPLICITO = new Set([TOOL_MEMORIA_LETTURA, TOOL_MEMORIA_SCRITTURA])

export const openAiTools: ChatCompletionTool[] = supabaseTools.map((tool) => {
  const shape = { ...tool.inputSchema } as Record<string, z.ZodTypeAny>
  if (TOOL_CON_PUBKEY_IMPLICITO.has(tool.name)) delete shape.pubkey_persona
  const schema = z.object(shape)
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: zodToJsonSchema(schema) as Record<string, unknown>,
    },
  }
})

export async function eseguiTool(name: string, argsJson: string, pubkeyCorrente?: string): Promise<string> {
  const tool = supabaseTools.find((t) => t.name === name)
  if (!tool) {
    return `Errore: tool "${name}" inesistente.`
  }
  try {
    const rawArgs = argsJson ? JSON.parse(argsJson) : {}
    const args = TOOL_CON_PUBKEY_IMPLICITO.has(name) && pubkeyCorrente ? { ...rawArgs, pubkey_persona: pubkeyCorrente } : rawArgs
    const parsedArgs = z.object(tool.inputSchema).parse(args)
    const result = await (tool.handler as (args: unknown) => Promise<unknown>)(parsedArgs)
    return JSON.stringify(result)
  } catch (err) {
    return `Errore: ${err instanceof Error ? err.message : String(err)}`
  }
}

/** Riassunto compatto (poche righe, le più recenti) di cosa si sa già su chi sta scrivendo ora —
 *  la parte "sempre visibile" della memoria a divulgazione progressiva: il resto lo recupera
 *  l'agente da solo con leggi_memoria_persona se la conversazione lo richiede davvero. */
export async function recuperaProfiloCompatto(pubkeyCorrente: string): Promise<string | null> {
  const risultato = await eseguiTool(TOOL_MEMORIA_LETTURA, JSON.stringify({ limite: 6 }), pubkeyCorrente)
  if (risultato.startsWith('Errore:')) return null

  const righe = JSON.parse(risultato) as Array<{ contenuto: string; categoria: string }>
  if (righe.length === 0) return null

  return (
    'Quello che sai già sulla persona che ti sta scrivendo ora (approfondisci con leggi_memoria_persona se serve):\n' +
    righe.map((r) => `- (${r.categoria}) ${r.contenuto}`).join('\n')
  )
}
