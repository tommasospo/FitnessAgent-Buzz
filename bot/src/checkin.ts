import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { supabase } from '../../mcp-server/src/supabase.js'
import { env } from './env.js'
import type { BuzzRelayClient } from './relay.js'
import { rispondi } from './llm.js'
import { eseguiTool } from './tools-bridge.js'

// Check-in privato settimanale (uno per bot, PT e Nutrizionista separatamente): feedback su
// commenti scritti nel canale, aderenza ad allenamenti/nutrizione ed eventuali next step —
// inviato in DM invece che nel gruppo, di iniziativa del bot il lunedì, non su richiesta
// dell'utente. Riusa la stessa nozione di "check settimanale del lunedì" già presente in
// registra_intervento (mcp-server/src/tools.ts), che lo esclude dal tetto di interventi
// proattivi — qui però lo scateniamo davvero, invece di lasciarlo alla discrezione del modello
// durante una conversazione.
//
// Idempotente per riavvio/redeploy: "l'ho già mandato questa settimana" si verifica leggendo
// intervento_agente su Supabase, non uno stato in memoria di processo — coerente con la scelta
// documentata in DEPLOY.md di fare `pm2 delete` + `pm2 start` a ogni aggiornamento.

const CONTROLLO_INTERVALLO_MS = 15 * 60 * 1000
const CHECKIN_GIORNO_SETTIMANA = 1 // lunedì (Date#getUTCDay: 0 = domenica, 1 = lunedì)
const CHECKIN_ORA_UTC = 8 // ~9-10 in Europa, a seconda dell'ora legale — non serve precisione al minuto

const PROMPT_CHECKIN =
  "È lunedì: manda il check-in privato settimanale (non nel canale di gruppo, questo è privato). Usa i tool a " +
  "disposizione per guardare cosa è successo nell'ultima settimana nel tuo ambito (piano attivo, sessioni " +
  "eseguite o saltate, metriche, obiettivi) e nella cronologia qui sopra per i commenti scritti nel canale. Dai " +
  "un feedback breve e concreto: come sta andando rispetto al piano, cosa hai notato di buono o da correggere, " +
  "e — solo se c'è davvero qualcosa da dire — un prossimo passo. Tono diretto, niente saluti di circostanza, " +
  "nessuna domanda retorica: è un messaggio, non l'apertura di una conversazione."

function inizioSettimanaCorrenteISO(): string {
  const ora = new Date()
  const giorno = ora.getUTCDay() || 7 // domenica -> 7, così lunedì resta il giorno 1
  const inizio = new Date(Date.UTC(ora.getUTCFullYear(), ora.getUTCMonth(), ora.getUTCDate()))
  inizio.setUTCDate(inizio.getUTCDate() - giorno + 1)
  return inizio.toISOString()
}

function eOraDiCheckin(): boolean {
  const ora = new Date()
  return ora.getUTCDay() === CHECKIN_GIORNO_SETTIMANA && ora.getUTCHours() === CHECKIN_ORA_UTC
}

async function giaInviatoQuestaSettimana(): Promise<boolean> {
  const { count, error } = await supabase
    .from('intervento_agente')
    .select('id', { count: 'exact', head: true })
    .eq('tipo', 'check_settimanale')
    .eq('autore_agente', env.agentName)
    .gte('data', inizioSettimanaCorrenteISO())
  if (error) throw new Error(error.message)
  return (count ?? 0) > 0
}

async function eseguiCheckSeENecessario(
  client: BuzzRelayClient,
  systemPrompt: string,
  cronologiaCanale: ChatCompletionMessageParam[],
): Promise<void> {
  if (!eOraDiCheckin()) return
  if (await giaInviatoQuestaSettimana()) return

  console.log(`[${env.agentName}] avvio check-in settimanale privato...`)
  const messaggio = await rispondi(systemPrompt, [...cronologiaCanale, { role: 'user', content: PROMPT_CHECKIN }])

  const channelId = await client.apriDM(env.ownerPubkey)
  await client.inviaMessaggio(channelId, messaggio, env.ownerPubkey)

  const esitoRegistrazione = await eseguiTool(
    'registra_intervento',
    JSON.stringify({ tipo: 'check_settimanale', contenuto: messaggio }),
  )
  if (esitoRegistrazione.startsWith('Errore:')) throw new Error(esitoRegistrazione)

  console.log(`[${env.agentName}] check-in settimanale privato inviato`)
}

/** Avvia il controllo periodico: da qui in poi il check-in parte da solo, senza bisogno di un
 *  messaggio dell'utente che lo triggeri. `getCronologiaCanale` è una funzione (non l'array
 *  direttamente) perché la cronologia del canale continua a crescere dopo l'avvio. */
export function avviaSchedulerCheckin(
  client: BuzzRelayClient,
  systemPrompt: string,
  getCronologiaCanale: () => ChatCompletionMessageParam[],
): void {
  const tick = () => {
    eseguiCheckSeENecessario(client, systemPrompt, getCronologiaCanale()).catch((err) =>
      console.error(`[${env.agentName}] errore nel check-in settimanale:`, err),
    )
  }
  tick()
  setInterval(tick, CONTROLLO_INTERVALLO_MS)
}
