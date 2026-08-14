import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { env } from './env.js'
import { BuzzRelayClient, type ChannelMessage } from './relay.js'
import { loadPersona } from './persona.js'
import { rispondi, dovreiRispondere } from './llm.js'
import { avviaSchedulerCheckin } from './checkin.js'
import { recuperaProfiloCompatto } from './tools-bridge.js'

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

// Cronologia per canale (gruppo + una per ogni DM) — non più un'unica cronologia condivisa, per
// non far trapelare contenuto privato di una DM nel canale di gruppo (o viceversa). Non più
// per-thread: le risposte sono messaggi piatti in sequenza, non annidate in thread separati (vedi
// relay.ts publishReply). Copre solo i messaggi osservati da quando il bot è partito e vive in
// memoria per processo: si perde a un riavvio, il che è accettabile per ora.
const MAX_TURNI = 40
const cronologiePerCanale = new Map<string, ChatCompletionMessageParam[]>()

function registraTurno(channelId: string, turno: ChatCompletionMessageParam): void {
  const cronologia = cronologiePerCanale.get(channelId) ?? []
  cronologia.push(turno)
  if (cronologia.length > MAX_TURNI) cronologia.splice(0, cronologia.length - MAX_TURNI)
  cronologiePerCanale.set(channelId, cronologia)
}

async function main() {
  console.log(`[${env.agentName}] connessione a ${env.relayUrl}...`)
  await client.connect()
  console.log(`[${env.agentName}] autenticato, pubkey ${client.publicKeyHex}`)

  await client.publishProfile(env.agentDisplayName)
  console.log(`[${env.agentName}] profilo pubblicato`)

  client.subscribeChannel(env.channelId, (event) => {
    handleEvent(event, env.channelId, false).catch((err) => console.error(`[${env.agentName}] errore gestendo evento:`, err))
  })
  console.log(`[${env.agentName}] in ascolto sul canale ${env.channelId}`)

  // Scopre le DM di cui sono già membro e quelle aperte in futuro (da me o da altri) — senza
  // questo, un messaggio privato non arriva mai al bot: non c'è modo di conoscerne il channel_id
  // in anticipo, a differenza del canale di gruppo configurato via env.
  client.scopriCanali((channelId) => {
    console.log(`[${env.agentName}] nuovo canale scoperto: ${channelId}`)
    // since:0 sulla prima sottoscrizione — recupera anche messaggi inviati prima che il bot se ne
    // accorgesse (es. una DM aperta e scritta mentre il bot era temporaneamente disconnesso).
    client.subscribeChannel(
      channelId,
      (event) => {
        handleEvent(event, channelId, true).catch((err) => console.error(`[${env.agentName}] errore gestendo evento DM:`, err))
      },
      0,
    )
  })

  avviaSchedulerCheckin(client, systemPrompt, () => cronologiePerCanale.get(env.channelId) ?? [])
}

async function handleEvent(event: ChannelMessage, channelId: string, isDm: boolean) {
  if (event.pubkey === client.publicKeyHex) return // mai rispondere a sé stesso

  const mittente = event.pubkey.slice(0, 8)
  registraTurno(channelId, { role: 'user', content: `[${mittente}] ${event.content}` })

  // Serve comunque leggere ogni messaggio e tenerlo in cronologia (fatto sopra) per avere
  // contesto anche quando l'agente decide di non intervenire.
  // In una DM 1:1 non c'è ambiguità su chi debba rispondere — sono l'unico destinatario, quindi
  // rispondo sempre, senza passare dal giudizio spontaneo.
  const menzionato = isDm || eIndirizzatoAMe(event)

  if (!menzionato) {
    // Con un altro agente rispondiamo solo su menzione esplicita (vedi eDaAltroAgente).
    if (eDaAltroAgente(event)) return

    // Già rivolto esplicitamente a un altro agente: non è una decisione mia da prendere.
    if (eIndirizzatoAdAltroAgente(event)) return

    const vuoleIntervenire = await dovreiRispondere(systemPrompt, cronologiePerCanale.get(channelId) ?? [])
    if (!vuoleIntervenire) return
  }

  console.log(
    `[${env.agentName}] ${isDm ? 'DM' : menzionato ? 'menzionato' : 'intervento spontaneo'}: "${event.content.slice(0, 80)}"`,
  )
  const notaProfilo = await recuperaProfiloCompatto(event.pubkey).catch(() => null)
  const risposta = await rispondi(systemPrompt, cronologiePerCanale.get(channelId) ?? [], {
    pubkeyCorrente: event.pubkey,
    notaProfilo,
  })
  registraTurno(channelId, { role: 'assistant', content: risposta })
  await client.publishReply(channelId, event, risposta)
  console.log(`[${env.agentName}] risposta pubblicata${isDm ? ' (DM)' : ''}`)
}

main().catch((err) => {
  console.error(`[${env.agentName}] errore fatale:`, err)
  process.exit(1)
})

process.on('SIGINT', () => {
  client.close()
  process.exit(0)
})
