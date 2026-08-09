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

export class BuzzRelayClient {
  private ws: WebSocket | null = null
  private secretKey: Uint8Array
  private pubkey: string
  private relayUrl: string
  private pendingOk = new Map<string, { resolve: () => void; reject: (err: Error) => void }>()

  constructor(relayUrl: string, privateKeyHex: string) {
    this.relayUrl = relayUrl
    this.secretKey = hexToBytes(privateKeyHex)
    this.pubkey = getPublicKey(this.secretKey)
  }

  get publicKeyHex() {
    return this.pubkey
  }

  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(this.relayUrl)
      this.ws.once('open', () => resolve())
      this.ws.once('error', reject)
      this.ws.on('message', (raw) => this.handleMessage(raw.toString()))
    })
    await this.waitForAuthChallenge()
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
    const subId = `channel-${channelId}-${Math.random().toString(36).slice(2, 8)}`
    this.onEventBySub.set(subId, onMessage)
    const since = Math.floor(Date.now() / 1000)
    this.ws?.send(
      JSON.stringify(['REQ', subId, { kinds: [KIND_CHANNEL_MESSAGE], '#h': [channelId], since }]),
    )
  }

  /** Pubblica una risposta nel canale, in risposta diretta al messaggio che l'ha attivata. */
  async publishReply(channelId: string, triggerEvent: ChannelMessage, content: string): Promise<void> {
    const event = this.sign({
      kind: KIND_CHANNEL_MESSAGE,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['h', channelId],
        ['e', triggerEvent.id, '', 'reply'],
        ['p', triggerEvent.pubkey],
      ],
      content,
    })
    await this.publishRaw(event)
  }

  close(): void {
    this.ws?.close()
  }
}
