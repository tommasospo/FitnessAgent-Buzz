import { env } from './env.js'
import { BuzzRelayClient, type ChannelMessage } from './relay.js'
import { loadPersona } from './persona.js'
import { rispondi } from './llm.js'

const systemPrompt = loadPersona(env.personaPath)

const client = new BuzzRelayClient(env.relayUrl, env.botPrivateKeyHex)

function eIndirizzatoAMe(event: ChannelMessage): boolean {
  if (event.pubkey === client.publicKeyHex) return false // mai rispondere a sé stesso
  return event.tags.some((tag) => tag[0] === 'p' && tag[1] === client.publicKeyHex)
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
  if (!eIndirizzatoAMe(event)) return

  console.log(`[${env.agentName}] menzionato: "${event.content.slice(0, 80)}"`)
  const risposta = await rispondi(systemPrompt, event.content)
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
