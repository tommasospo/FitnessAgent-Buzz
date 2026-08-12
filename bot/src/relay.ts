import WebSocket from 'ws'
import { finalizeEvent, getPublicKey, type Event, type EventTemplate } from 'nostr-tools/pure'
import { hexToBytes } from '@noble/hashes/utils'

// Client minimale per il relay Buzz (protocollo Nostr con estensioni Buzz).
// Segue esattamente la sequenza connect -> AUTH (NIP-42) -> pubblica profilo
// -> REQ sul canale -> EVENT/EOSE -> pubblica risposta, verificata leggendo
// crates/buzz-relay e crates/buzz-sdk del progetto Buzz (vedi memoria di
// progetto "wiring tool agenti Buzz↔Supabase").

const KIND_PROFILE = 0
const KIND_CHANNEL_MESSAGE = 9
const KIND_AUTH = 22242

export interface ChannelMessage {
  id: string
  pubkey: string
  content: string
  tags: string[][]
  created_at: number
}

/** Radice del thread a cui appartiene l'evento (il suo tag 'e' marcato 'root', o 'reply' se manca il
 *  root, o l'id dell'evento stesso se non ha alcuna ancestry) — stessa risoluzione usata dal relay in
 *  resolve_nip10_thread_meta, utile per raggruppare la cronologia di una conversazione per thread. */
export function threadRootId(event: ChannelMessage): string {
  const rootTag = event.tags.find((t) => t[0] === 'e' && t[3] === 'root')
  const replyTag = event.tags.find((t) => t[0] === 'e' && t[3] === 'reply')
  return rootTag?.[1] ?? replyTag?.[1] ?? event.id
}

const RECONNECT_BASE_DELAY_MS = 1_000
const RECONNECT_MAX_DELAY_MS = 30_000

// Un websocket "muto" (rete caduta senza un vero TCP close/reset, es. Wi-Fi
// spento e riacceso in fretta) non genera da solo un evento 'close': va
// sondato attivamente con ping/pong, altrimenti la connessione resta appesa
// per sempre senza che il client se ne accorga.
const HEARTBEAT_INTERVAL_MS = 20_000

export class BuzzRelayClient {
  private ws: WebSocket | null = null
  private secretKey: Uint8Array
  private pubkey: string
  private relayUrl: string
  private pendingOk = new Map<string, { resolve: () => void; reject: (err: Error) => void }>()

  // Stato ricordato per ripetere automaticamente auth -> profilo -> sottoscrizioni
  // dopo una riconnessione (il relay non mantiene queste cose tra una connessione
  // websocket e l'altra).
  private hasConnectedOnce = false
  private manualClose = false
  private reconnectAttempt = 0
  private displayName: string | null = null
  private channelSubs: { channelId: string; onMessage: (event: ChannelMessage) => void }[] = []
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private isAlive = true

  constructor(relayUrl: string, privateKeyHex: string) {
    this.relayUrl = relayUrl
    this.secretKey = hexToBytes(privateKeyHex)
    this.pubkey = getPublicKey(this.secretKey)
  }

  get publicKeyHex() {
    return this.pubkey
  }

  async connect(): Promise<void> {
    this.manualClose = false
    await this.doConnect()
    this.hasConnectedOnce = true
  }

  private async doConnect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.relayUrl)
      this.ws = ws
      ws.once('open', () => resolve())
      ws.once('error', reject)
      ws.on('message', (raw) => this.handleMessage(raw.toString()))
    })
    await this.waitForAuthChallenge()
    this.reconnectAttempt = 0

    // Un websocket nuovo non ha memoria di profilo/sottoscrizioni: se questa è
    // una riconnessione (non la prima connessione), li ripetiamo qui.
    this.ws?.on('close', () => this.handleDisconnect())
    this.ws?.on('error', (err) => console.error('[relay] errore websocket:', err))
    this.startHeartbeat()

    if (this.hasConnectedOnce) {
      console.log('[relay] riconnesso, ripristino profilo e sottoscrizioni...')
      if (this.displayName) {
        await this.publishProfileFrame(this.displayName).catch((err) =>
          console.error('[relay] errore ripubblicando il profilo dopo la riconnessione:', err),
        )
      }
      this.onEventBySub.clear()
      for (const sub of this.channelSubs) this.sendSubscribeFrame(sub.channelId, sub.onMessage)
    }
  }

  private handleDisconnect(): void {
    this.stopHeartbeat()
    if (this.manualClose) return
    for (const pending of this.pendingOk.values()) {
      pending.reject(new Error('Connessione al relay persa'))
    }
    this.pendingOk.clear()
    this.scheduleReconnect()
  }

  /** Sonda periodicamente la connessione con un ping: se non arriva un pong
   *  entro il giro successivo, il socket è considerato morto e forzato alla
   *  chiusura (che a sua volta innesca la riconnessione). Necessario perché
   *  una rete caduta e tornata in fretta spesso non genera da sola un evento
   *  'close' o 'error'. */
  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.isAlive = true
    const ws = this.ws
    ws?.on('pong', () => {
      this.isAlive = true
    })
    this.heartbeatTimer = setInterval(() => {
      if (!this.isAlive) {
        console.error('[relay] nessun pong ricevuto, connessione considerata morta: forzo la riconnessione')
        ws?.terminate()
        return
      }
      this.isAlive = false
      ws?.ping()
    }, HEARTBEAT_INTERVAL_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private scheduleReconnect(): void {
    const delayMs = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempt)
    this.reconnectAttempt++
    console.log(`[relay] connessione persa, riprovo tra ${Math.round(delayMs / 1000)}s...`)
    setTimeout(() => {
      if (this.manualClose) return
      this.doConnect().catch((err) => {
        console.error('[relay] tentativo di riconnessione fallito:', err.message ?? err)
        this.scheduleReconnect()
      })
    }, delayMs)
  }

  private waitForAuthChallenge(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout in attesa della sfida AUTH del relay')), 10_000)
      const handler = (raw: Buffer | string) => {
        const frame = JSON.parse(raw.toString())
        if (frame[0] === 'AUTH') {
          clearTimeout(timeout)
          this.ws?.off('message', handler)
          this.sendAuth(frame[1]).then(resolve, reject)
        }
      }
      this.ws?.on('message', handler)
    })
  }

  private async sendAuth(challenge: string): Promise<void> {
    const event = this.sign({
      kind: KIND_AUTH,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['relay', this.relayUrl],
        ['challenge', challenge],
      ],
      content: '',
    })
    await this.publishRaw(event, 'AUTH')
  }

  private sign(template: EventTemplate): Event {
    return finalizeEvent(template, this.secretKey)
  }

  private handleMessage(raw: string) {
    let frame: unknown[]
    try {
      frame = JSON.parse(raw)
    } catch {
      return
    }
    const [type] = frame as [string, ...unknown[]]

    if (type === 'OK') {
      const [, eventId, ok, message] = frame as [string, string, boolean, string]
      const pending = this.pendingOk.get(eventId)
      if (pending) {
        this.pendingOk.delete(eventId)
        if (ok) pending.resolve()
        else pending.reject(new Error(`Relay ha rifiutato l'evento ${eventId}: ${message}`))
      }
      return
    }

    if (type === 'NOTICE') {
      console.error('[relay NOTICE]', frame[1])
      return
    }

    if (type === 'EVENT') {
      const [, subId, event] = frame as [string, string, Event]
      this.onEventBySub.get(subId)?.(event as unknown as ChannelMessage)
    }
  }

  private publishRaw(event: Event, frameType: 'EVENT' | 'AUTH' = 'EVENT'): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pendingOk.set(event.id, { resolve, reject })
      this.ws?.send(JSON.stringify([frameType, event]))
      setTimeout(() => {
        if (this.pendingOk.has(event.id)) {
          this.pendingOk.delete(event.id)
          reject(new Error(`Timeout in attesa di OK per l'evento ${event.id}`))
        }
      }, 10_000)
    })
  }

  async publishProfile(displayName: string): Promise<void> {
    this.displayName = displayName
    await this.publishProfileFrame(displayName)
  }

  private async publishProfileFrame(displayName: string): Promise<void> {
    const event = this.sign({
      kind: KIND_PROFILE,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: JSON.stringify({ name: displayName, display_name: displayName }),
    })
    await this.publishRaw(event)
  }

  private onEventBySub = new Map<string, (event: ChannelMessage) => void>()

  subscribeChannel(channelId: string, onMessage: (event: ChannelMessage) => void): void {
    this.channelSubs.push({ channelId, onMessage })
    this.sendSubscribeFrame(channelId, onMessage)
  }

  private sendSubscribeFrame(channelId: string, onMessage: (event: ChannelMessage) => void): void {
    const subId = `channel-${channelId}-${Math.random().toString(36).slice(2, 8)}`
    this.onEventBySub.set(subId, onMessage)
    const since = Math.floor(Date.now() / 1000)
    this.ws?.send(
      JSON.stringify(['REQ', subId, { kinds: [KIND_CHANNEL_MESSAGE], '#h': [channelId], since }]),
    )
  }

  /** Pubblica una risposta nel canale, in risposta diretta al messaggio che l'ha attivata.
   *
   * Il relay valida che il tag 'e' marcato 'root' corrisponda alla vera radice del thread
   * (buzz-relay/src/handlers/ingest.rs, resolve_nip10_thread_meta): se il messaggio che ha
   * attivato la risposta è già esso stesso dentro un thread (ha un proprio tag 'root' o
   * 'reply'), dobbiamo propagare quella stessa radice, non limitarci a puntare al messaggio
   * scatenante — altrimenti il relay rifiuta l'evento con "root tag does not match thread
   * ancestry" e la risposta va persa in silenzio.
   */
  async publishReply(channelId: string, triggerEvent: ChannelMessage, content: string): Promise<void> {
    const rootId = threadRootId(triggerEvent)

    const tags: string[][] = [['h', channelId]]
    if (rootId !== triggerEvent.id) {
      tags.push(['e', rootId, '', 'root'])
    }
    tags.push(['e', triggerEvent.id, '', 'reply'])
    tags.push(['p', triggerEvent.pubkey])

    const event = this.sign({
      kind: KIND_CHANNEL_MESSAGE,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content,
    })
    await this.publishRaw(event)
  }

  close(): void {
    this.manualClose = true
    this.ws?.close()
  }
}
