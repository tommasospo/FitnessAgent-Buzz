import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { bytesToHex } from '@noble/hashes/utils'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

// Genera una nuova identità Nostr per un bot Buzz e la scrive in un file .env
// dedicato (mai stampata per intero altrove). Stampa solo la chiave PUBBLICA,
// da incollare nel dialogo "Add member" di Buzz Desktop.
//
// Uso: npm run genkey -- <slug>   (es. "pt" o "nutrizionista")

const slug = process.argv[2]
if (!slug) {
  console.error('Uso: npm run genkey -- <slug>   (es. "pt" o "nutrizionista")')
  process.exit(1)
}

const envPath = `.env.${slug}`

if (existsSync(envPath) && readFileSync(envPath, 'utf8').includes('BUZZ_BOT_PRIVATE_KEY=')) {
  console.error(`${envPath} ha già una BUZZ_BOT_PRIVATE_KEY. Non la sovrascrivo.`)
  process.exit(1)
}

const secretKey = generateSecretKey()
const privateKeyHex = bytesToHex(secretKey)
const publicKeyHex = getPublicKey(secretKey)
const npub = nip19.npubEncode(publicKeyHex)

const line = `BUZZ_BOT_PRIVATE_KEY=${privateKeyHex}\n`
if (existsSync(envPath)) {
  writeFileSync(envPath, readFileSync(envPath, 'utf8') + line)
} else {
  writeFileSync(envPath, line)
}

console.log(`Identità creata e salvata in ${envPath} (chiave privata mai stampata).`)
console.log(``)
console.log(`Chiave pubblica (hex):  ${publicKeyHex}`)
console.log(`Chiave pubblica (npub): ${npub}`)
console.log(``)
console.log(`Incolla una delle due in Buzz Desktop per aggiungere questo bot come membro.`)
