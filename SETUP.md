# SETUP — Buzz in locale, Fase 1 (validazione del formato)

Questa guida copre solo la Fase 1 descritta nel PRD (`PRD-portale-benessere-agenti.md`): due agenti che discutono tra loro in un canale, **senza dati reali, senza database applicativo, senza app**. L'obiettivo è verificare se il formato "tavolo di consulto" funziona, non costruire il sistema finale.

Buzz gira **interamente sul tuo Mac**. Nessun dato lascia la tua macchina, nessuna istanza di terzi coinvolta — questa è la scelta fatta apposta perché in Buzz i canali di gruppo non sono cifrati end-to-end (sono solo firmati, protetti da controllo di accesso a livello di database): l'unica garanzia di privacy per dati sanitari è che il database sia fisicamente sotto il tuo controllo esclusivo. Vedi la sezione "Perché in locale" in fondo per il dettaglio.

Nota di terminologia per non confonderti: ci sono **due repository distinti** in questo progetto:
- **`block/buzz`** — il codice della piattaforma Buzz stessa (di Block). Lo clonerai per far girare il programma.
- **`tommasospo/FitnessAgent-Buzz`** — il *nostro* repository, dove vivono questo file, le persone dei due agenti e i documenti di progetto. Non contiene codice di Buzz, solo configurazione e documentazione nostra.

---

## Parte 1 — Cose da fare tu a mano (una tantum)

### 1.1 Installa Docker Desktop
Buzz usa Docker per far girare Postgres, Redis e altri servizi di supporto in locale (è infrastruttura interna di Buzz, non il "database applicativo" che il PRD esclude dalla Fase 1 — quello arriva in fase 3).

- Vai su https://www.docker.com/products/docker-desktop/, scarica la versione per Mac (Apple Silicon se il tuo Mac è M1/M2/M3/M4, Intel altrimenti), installa e apri l'app almeno una volta per completare il setup iniziale.

### 1.2 Installa gli strumenti da riga di comando
Apri l'app **Terminale** (Applicazioni → Utility → Terminale) e verifica di avere `git`:

```bash
git --version
```

Se non è installato, macOS ti proporrà da solo di installare gli "strumenti da riga di comando per gli sviluppatori" — accetta.

### 1.3 Decidi come autenticare gli agenti verso il modello AI

Ogni agente deve appoggiarsi a un modello Claude. Ci sono due strade, scegline **una**:

**Opzione consigliata — riusa il tuo account Claude Code** (nessun costo aggiuntivo, nessuna chiave da gestire):
Se hai già Claude Code installato e autenticato su questo Mac, puoi usare la modalità di login OAuth (`claude auth status` deve risultare autenticato). Gli agenti useranno questo stesso account.

**Opzione alternativa — chiave API Anthropic separata** (fatturazione a consumo, indipendente dal tuo abbonamento Claude):
1. Vai su https://console.anthropic.com/ e crea un account (o accedi).
2. Genera una API key nella sezione "API Keys".
3. Tienila da parte: andrà in una variabile d'ambiente `ANTHROPIC_API_KEY` quando avvii Buzz.

Se non sai quale scegliere: usa la prima, è più semplice e non richiede carta di credito separata.

### 1.4 Crea il repository di progetto in locale

Questo è il repo `tommasospo/FitnessAgent-Buzz` che mi hai già creato (vuoto) su GitHub — ci pusheremo questo file, le persone degli agenti e il resto della documentazione. Non serve fare nulla qui adesso: lo popoliamo insieme e alla fine ti chiedo conferma prima di pushare.

---

## Parte 2 — Installare e avviare Buzz (piattaforma)

Questi comandi li eseguo io con te quando sei pronto, ma li riporto qui per trasparenza — puoi anche copiarli tu stesso nel Terminale se preferisci procedere in autonomia.

```bash
# 1. Clona il codice della piattaforma Buzz (repo diverso dal nostro progetto)
git clone https://github.com/block/buzz.git
cd buzz

# 2. Attiva l'ambiente di sviluppo (scarica in automatico Rust, Node, pnpm, just)
. ./bin/activate-hermit

# 3. Setup una tantum: copia .env di esempio, avvia i servizi Docker, applica le migrazioni
just setup
just build
```

Se hai scelto l'opzione "chiave API Anthropic" al punto 1.3, apri il file `.env` creato al passo `just setup` e imposta:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Poi, ogni volta che vuoi usare Buzz:

```bash
. ./bin/activate-hermit
just dev
```

Questo comando avvia **sia** il relay locale (`ws://localhost:3000`) **sia** l'app desktop di Buzz, che si apre da sola come una normale applicazione Mac.

---

## Parte 3 — Primo avvio e identità

Al primo avvio, l'app desktop ti guida in un breve onboarding e **genera automaticamente la tua identità** (una chiave crittografica Nostr) — non devi copiare, generare o custodire nulla a mano. È la tua identità come partecipante umano ai canali.

---

## Parte 4 — Creare il canale e i due agenti

### 4.1 Crea il canale condiviso
Nell'app desktop: pulsante **"Add a channel"** → crealo come **privato** e chiamalo `#consulto`.

### 4.2 Crea i due agenti
Nell'app desktop c'è un pannello **"Managed Agents"**: per ciascun agente definisci nome, avatar (opzionale), **system prompt** e modello/provider.

Per il **system prompt** di ciascun agente, copia-incolla l'intero contenuto del rispettivo file di persona (li trovi in `agents/` in questo stesso progetto):

- `agents/personal-trainer.persona.md` → agente "Personal Trainer"
- `agents/nutrizionista.persona.md` → agente "Nutrizionista"

Come provider/modello: scegli la stessa opzione decisa al punto 1.3 (login Claude riusato, oppure Anthropic API key).

### 4.3 Aggiungi entrambi gli agenti al canale
Dentro `#consulto`: **"Add an agent to a channel"** (si fa esattamente come aggiungere una persona) — aggiungi sia il trainer sia il nutrizionista.

### 4.4 DM con ciascun agente
Aprendo la scheda di un singolo agente si apre automaticamente la possibilità di scrivergli in DM, separatamente da `#consulto`. Non serve configurazione aggiuntiva: è lo stesso agente, solo in un canale privato 1:1 invece che nel canale condiviso.

Struttura finale dei canali (coerente con PRD §10.1, nessun coordinatore, nessuna gerarchia):

```
#consulto          → tu + Personal Trainer + Nutrizionista, canale condiviso
DM con Trainer     → tu + Personal Trainer, uno a uno
DM con Nutrizionista → tu + Nutrizionista, uno a uno
```

Non creiamo `#log` in questa fase: è opzionale nel PRD e non ha senso senza un database applicativo che generi eventi.

---

## Perché in locale (nota sulla decisione di hosting)

Buzz è costruito su Nostr con un event log firmato. Verificando il codice della piattaforma: i messaggi **di canale** (compreso un canale privato come `#consulto`) sono salvati **in chiaro** nel database — il canale privato è invisibile a chi non ne fa parte, ma non è cifrato end-to-end. Solo i DM usano cifratura reale (NIP-17). Questo significa che la sicurezza dei tuoi dati sanitari discussi in `#consulto` dipende interamente da **chi ha accesso al server/database**, non da crittografia.

Per questo la Fase 1 gira sulla tua macchina fisica: il database di Buzz è sul tuo Mac, quindi "chi ha accesso" coincide esattamente con "tu". Quando vorremo tenerlo acceso 24/7 (fasi successive), la stessa logica implica auto-hosting su un server sotto il tuo controllo esclusivo (VPS o Railway su progetto tuo) — mai un'istanza gestita da terzi.

---

## Prossimo passo

Una volta completata la Parte 1 (Docker Desktop installato, decisione presa su 1.3), dimmelo e procediamo insieme con clone, build e avvio.
