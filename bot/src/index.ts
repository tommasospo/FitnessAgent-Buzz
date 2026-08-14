import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { env } from './env.js'
import { BuzzRelayClient, type ChannelMessage } from './relay.js'
import { loadPersona } from './persona.js'
import { rispondi, dovreiRispondere } from './llm.js'
import { avviaSchedulerCheckin } from './checkin.js'

const systemPrompt = loadPersona(env.personaPath)

const client = new BuzzRelayClient(env.relayUrl, env.botPrivateKeyHex)

function eIndirizzatoAMe(event: ChannelMessage): boolean {
  if (event.pubkey === client.publicKeyHex) return false // mai rispondere a sé stesso
  return event.tags.some((tag) => tag[0] === 'p' && tag[1] === client.publicKeyHex)
}

// Un altro agente bot nello stesso canale (es. PT vs Nutrizionista): a questi rispondiamo solo
// su menzione esplicita, mai di iniziativa — altrimenti due agenti che si sentono entrambi "in
// causa" sullo stesso messaggio potrebbero rispondersi a vicenda all'infinito.
function eDaAltroAgente(event: ChannelMessage): boolean {
  return env.peerAgentPubkeys.includes(event.pubkey)
}

// L'utente ha @menzionato esplicitamente un altro agente (non me) in questo messaggio: la scelta
// di chi debba rispondere è già stata fatta, non è ambigua — non va rimessa in discussione dal
// giudizio spontaneo di dovreiRispondere, altrimenti l'agente non menzionato può comunque
// intromettersi in una domanda diretta a qualcun altro.
function eIndirizzatoAdAltroAgente(event: ChannelMessage): boolean {
  return event.tags.some((tag) => tag[0] === 'p' && env.peerAgentPubkeys.includes(tag[1]))
}

// Cronologia dell'intero canale (non più per-thread: le risposte sono messaggi piatti in
// sequenza, non annidate in thread separati — vedi relay.ts publishReply). Dà comunque
// all'agente memoria dello scambio in corso, comprese le battute dell'altro agente. Copre solo
// i messaggi osservati da quando il bot è partito e vive in memoria per processo: si perde a un
// riavvio, il che è accettabile per ora.
const MAX_TURNI = 40
let cronologiaCanale: ChatCompletionMessageParam[] = []

function registraTurno(turno: ChatCompletionMessageParam): void {
  cronologiaCanale.push(turno)
  if (cronologiaCanale.length > MAX_TURNI) cronologiaCanale.splice(0, cronologiaCanale.length - MAX_TURNI)
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

  avviaSchedulerCheckin(client, systemPrompt, () => cronologiaCanale)
}

async function handleEvent(event: ChannelMessage) {
  if (event.pubkey === client.publicKeyHex) return // mai rispondere a sé stesso

  const mittente = event.pubkey.slice(0, 8)
  registraTurno({ role: 'user', content: `[${mittente}] ${event.content}` })

  // Serve comunque leggere ogni messaggio e tenerlo in cronologia (fatto sopra) per avere
  // contesto anche quando l'agente decide di non intervenire.
  const menzionato = eIndirizzatoAMe(event)

  if (!menzionato) {
    // Con un altro agente rispondiamo solo su menzione esplicita (vedi eDaAltroAgente).
    if (eDaAltroAgente(event)) return

    // Già rivolto esplicitamente a un altro agente: non è una decisione mia da prendere.
    if (eIndirizzatoAdAltroAgente(event)) return

    const vuoleIntervenire = await dovreiRispondere(systemPrompt, cronologiaCanale)
    if (!vuoleIntervenire) return
  }

  console.log(
    `[${env.agentName}] ${menzionato ? 'menzionato' : 'intervento spontaneo'}: "${event.content.slice(0, 80)}"`,
  )
  const risposta = await rispondi(systemPrompt, cronologiaCanale)
  registraTurno({ role: 'assistant', content: risposta })
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
