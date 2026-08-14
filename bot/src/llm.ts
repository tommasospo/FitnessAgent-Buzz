import OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { env } from './env.js'
import { openAiTools, eseguiTool } from './tools-bridge.js'

const openai = new OpenAI({ apiKey: env.openaiApiKey })

const MAX_TOOL_ITERATIONS = 6

export async function rispondi(
  systemPrompt: string,
  cronologia: ChatCompletionMessageParam[],
  opts: { pubkeyCorrente?: string; notaProfilo?: string | null } = {},
): Promise<string> {
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...(opts.notaProfilo ? [{ role: 'system', content: opts.notaProfilo } as ChatCompletionMessageParam] : []),
    ...cronologia,
  ]

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
      const result = await eseguiTool(toolCall.function.name, toolCall.function.arguments, opts.pubkeyCorrente)
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
        "Non sei stato menzionato esplicitamente (nessun tag) nell'ultimo messaggio. Prima di decidere, guarda gli " +
        "ultimi messaggi della cronologia qui sopra, non solo l'ultimo isolato. Rispondi 'NO' se anche solo una di " +
        "queste è vera: " +
        '(a) l\'ultimo messaggio si rivolge chiaramente, per nome o ruolo, a un\'altra persona o a un altro agente ' +
        'specifico (es. "nutrizionista, ...", "PT, ...", un nome proprio diverso dal tuo); ' +
        '(b) l\'ultimo messaggio è chiaramente una risposta o la continuazione di uno scambio in corso con un altro ' +
        'agente specifico — es. l\'altro agente ha appena fatto una domanda o un elenco di domande nei messaggi ' +
        'immediatamente precedenti, e questo messaggio sembra rispondere proprio a quelle (anche con risposte ' +
        'brevi e senza nominare nessuno esplicitamente, tipo una sequenza di dati in risposta a una lista numerata). ' +
        "In entrambi i casi la scelta di chi debba rispondere non è ambigua e non spetta a te, anche se l'argomento " +
        "in astratto rientrerebbe nel tuo ruolo. Solo se nessuna delle due si applica: in base al tuo ruolo, ti " +
        "senti comunque chiamato in causa e vuoi intervenire spontaneamente? Rispondi SOLO 'SI' o 'NO', nessun " +
        "altro testo. Nel dubbio rispondi 'NO'.",
    },
  ]

  const completion = await openai.chat.completions.create({
    model: env.openaiModel,
    messages,
    reasoning_effort: 'none',
    max_completion_tokens: 4,
  })

  const testo = completion.choices[0]?.message?.content?.trim().toUpperCase() ?? 'NO'
  return testo.startsWith('SI')
}
