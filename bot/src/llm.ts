import OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { env } from './env.js'
import { openAiTools, eseguiTool } from './tools-bridge.js'

const openai = new OpenAI({ apiKey: env.openaiApiKey })

const MAX_TOOL_ITERATIONS = 6

export async function rispondi(systemPrompt: string, cronologia: ChatCompletionMessageParam[]): Promise<string> {
  const messages: ChatCompletionMessageParam[] = [{ role: 'system', content: systemPrompt }, ...cronologia]

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const completion = await openai.chat.completions.create({
      model: env.openaiModel,
      messages,
      tools: openAiTools,
      reasoning_effort: 'none',
    })

    const choice = completion.choices[0]
    const message = choice.message

    if (!message.tool_calls || message.tool_calls.length === 0) {
      return message.content ?? '(nessuna risposta)'
    }

    messages.push(message)

    for (const toolCall of message.tool_calls) {
      if (toolCall.type !== 'function') continue
      const result = await eseguiTool(toolCall.function.name, toolCall.function.arguments)
      messages.push({ role: 'tool', tool_call_id: toolCall.id, content: result })
    }
  }

  return 'Mi servono troppi passaggi per rispondere a questa domanda, riprova con una richiesta più specifica.'
}

/** Giudizio leggero (nessun tool, una sola chiamata) su se intervenire di propria iniziativa in
 *  un messaggio che non menziona esplicitamente l'agente — "si sente chiamato in causa" invece di
 *  richiedere sempre il tag @. Deliberatamente prudente: in caso di dubbio risponde NO, per non
 *  intasare il canale con interventi non richiesti. */
export async function dovreiRispondere(systemPrompt: string, cronologia: ChatCompletionMessageParam[]): Promise<boolean> {
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...cronologia,
    {
      role: 'user',
      content:
        "Non sei stato menzionato esplicitamente nell'ultimo messaggio. In base al tuo ruolo, ti senti " +
        "comunque chiamato in causa e vuoi intervenire spontaneamente? Rispondi SOLO 'SI' o 'NO', nessun altro testo. " +
        "Nel dubbio rispondi 'NO'.",
    },
  ]

  const completion = await openai.chat.completions.create({
    model: env.openaiModel,
    messages,
    reasoning_effort: 'none',
    max_tokens: 4,
  })

  const testo = completion.choices[0]?.message?.content?.trim().toUpperCase() ?? 'NO'
  return testo.startsWith('SI')
}
