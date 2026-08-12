import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { env } from './env.js'
import { BuzzRelayClient, threadRootId, type ChannelMessage } from './relay.js'
import { loadPersona } from './persona.js'
import { rispondi } from './llm.js'

const systemPrompt = loadPersona(env.personaPath)

const client = new BuzzRelayClient(env.relayUrl, env.botPrivateKeyHex)

function eIndirizzatoAMe(event: ChannelMessage): boolean {
  if (event.pubkey === client.publicKeyHex) return false // mai rispondere a sé stesso
  return event.tags.some((tag) => tag[0] === 'p' && tag[1] === client.publicKeyHex)
}

// Cronologia per thread (chiave: id della radice, vedi threadRootId), così l'agente vede l'intero
// scambio invece di trattare ogni menzione come una richiesta isolata senza memoria di quanto detto
// prima nello stesso thread — comprese le battute dell'altro agente, non solo quelle dell'utente.
// Copre solo i messaggi osservati da quando il bot è partito (niente storico pre-avvio) e vive in
// memoria per processo: si perde a un riavvio, il che è accettabile per ora.
const MAX_TURNI_PER_THREAD = 30
const cronologiaPerThread = new Map<string, ChatCompletionMessageParam[]>()

function registraTurno(root: string, turno: ChatCompletionMessageParam): ChatCompletionMessageParam[] {
  const storia = cronologiaPerThread.get(root) ?? []
  storia.push(turno)
  if (storia.length > MAX_TURNI_PER_THREAD) storia.splice(0, storia.length - MAX_TURNI_PER_THREAD)
  cronologiaPerThread.set(root, storia)
  return storia
}

async function main() {
  console.log(`[${env.agentName}] connessione a ${env.relayUrl}...`)
  await client.connect()
  console.log(`[${env.agentName}] autenticato, pubkey ${client.publicKeyHex}`)

  await client.publishProfile(env.agentDisplayName)
  console.log(`[${env.agentName}] profilo pubblicato`)

  client.subscribeChannel(env.channelId, (event) => {
    handleEvent(event).catch((err) => console.error(`[${env.agentName}] errore gestendo evento:`, err))
  })
  console.log(`[${env.agentName}] in ascolto sul canale ${env.channelId}`)
}

async function handleEvent(event: ChannelMessage) {
  if (event.pubkey === client.publicKeyHex) return // mai rispondere a sé stesso

  const root = threadRootId(event)
  const mittente = event.pubkey.slice(0, 8)
  const storia = registraTurno(root, { role: 'user', content: `[${mittente}] ${event.content}` })

  // Serve comunque leggere ogni messaggio e tenerlo in cronologia (fatto sopra) per avere contesto
  // quando l'agente viene poi taggato — ma risponde solo su @menzione esplicita.
  if (!eIndirizzatoAMe(event)) return

  console.log(`[${env.agentName}] menzionato: "${event.content.slice(0, 80)}"`)
  const risposta = await rispondi(systemPrompt, storia)
  registraTurno(root, { role: 'assistant', content: risposta })
  await client.publishReply(env.channelId, event, risposta)
  console.log(`[${env.agentName}] risposta pubblicata`)
}

main().catch((err) => {
  console.error(`[${env.agentName}] errore fatale:`, err)
  process.exit(1)
})

process.on('SIGINT', () => {
  client.close()
  process.exit(0)
})
