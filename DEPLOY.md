# Deploy bot su un server esterno (es. Hetzner)

Cosa serve far girare fuori da questo Mac: **solo `bot/`** (due processi, PT e
Nutrizionista). Non serve nessun relay locale — la community Buzz vive sul relay
cloud `wss://fitness-2-0.communities.buzz.xyz`, non su qualcosa che ospitiamo noi
(vedi memoria di progetto "Architettura relay Buzz"). Non serve nemmeno deployare
`mcp-server/` come servizio a sé: `bot/` lo importa direttamente come modulo
sorgente (`bot/src/tools-bridge.ts` → `../../mcp-server/src/tools.js`), quindi gli
basta stare nella stessa checkout, con le proprie dipendenze installate.

## Prerequisiti sul server

- Node **22 LTS** (o un'altra LTS pari — non replicare una versione "current"
  dispari come quella usata in sviluppo su questo Mac).
- `git`.
- `pm2` globale: `npm i -g pm2`.

Nessun requisito particolare di disco: senza le build Rust di `buzz-platform`
(che qui non servono — quelle sono per Buzz Desktop/relay locale, non per i bot)
questi due processi Node pesano pochissimo.

## Primo deploy

```bash
git clone <url-repo-buzz> buzz && cd buzz
cd bot && npm ci && cd ../mcp-server && npm ci && cd ../bot
```

Poi i due file segreto, **mai via git**: copia `.env.pt.example` → `.env.pt` e
`.env.nutrizionista.example` → `.env.nutrizionista`, e riempi i 3 valori segnati
come segreti in ciascuno (chiave privata Nostr del bot, chiave OpenAI, service role
Supabase). Se stai migrando bot già esistenti (non crearne di nuovi), riusa le
stesse chiavi private Nostr che hanno oggi — altrimenti il canale li vede come due
identità nuove, senza la storia/pubkey note finora. Trasferiscile con `scp`
direttamente dal Mac al server, non incollandole in chat o in un file temporaneo
condiviso.

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # stampa un comando da lanciare una volta con sudo — fallo, così pm2
              # (e quindi i bot) ripartono da soli al riavvio del server
```

## Aggiornare dopo un `git pull`

```bash
git pull
cd bot && npm ci && cd ../mcp-server && npm ci && cd ../bot
pm2 delete buzz-bot-pt buzz-bot-nutrizionista
pm2 start ecosystem.config.cjs
pm2 save
```

**Usa sempre `pm2 delete` + `pm2 start`, mai solo `pm2 restart`.** pm2 cattura e
mette in cache l'ambiente risolto di un processo alla prima `pm2 start` e lo
riusa a ogni `restart` successivo — se una variabile in un `.env` cambia dopo,
`restart` non la rilegge, `delete` + `start` sì (vedi memoria di progetto
"Variabili d'ambiente che si sovrascrivono in silenzio").

## Verifica

```bash
pm2 logs               # dovrebbe mostrare "autenticato" e "in ascolto sul canale"
                        # per entrambi, nessun 401 su chiamate OpenAI
pm2 env <id>            # non deve comparire OPENAI_API_KEY qui — se compare,
                        # è cache di pm2 e non il valore del file .env
```
