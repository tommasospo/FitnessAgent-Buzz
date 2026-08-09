# PRD — Portale benessere multi-agente

**Nome in codice:** *da definire*
**Autore:** Tommy
**Data:** 5 agosto 2026
**Versione:** 1.0 (post-intervista di design)
**Stato:** pronto per la fase di progettazione tecnica

---

## 1. Sintesi

Un sistema personale in cui più agenti AI specializzati nella cura della persona (personal trainer, nutrizionista, e in futuro medico e fisioterapista) hanno accesso ai dati reali di allenamento, alimentazione e salute dell'utente, ne discutono insieme in una chat multi-agente su **Buzz**, e producono piani operativi che l'utente esegue e traccia in una **app dedicata**.

Il valore non sta nei singoli consigli — quelli li dà già qualunque chatbot. Sta nel **ciclo chiuso**: gli agenti prescrivono, l'utente esegue e riporta la realtà, gli agenti leggono la realtà e correggono la prescrizione.

**Non è** un prodotto commerciale, non è un dispositivo medico, non è multi-utente. È uno strumento personale a uso singolo, e questo vincolo è deliberato: elimina compliance, consenso di terzi e responsabilità professionale, permettendo di validare l'idea in settimane invece che in mesi.

---

## 2. Il problema

Chi si allena seriamente e cura l'alimentazione accumula dati in silos che non si parlano:

- gli allenamenti di corsa stanno su Garmin/Strava;
- i pesi e le serie in palestra stanno su un foglietto o in un'app che non sa nulla della corsa;
- i macro stanno in un'app alimentare che non sa che domani c'è il lungo;
- gli esami del sangue stanno in un PDF che non guarda nessuno;
- gli obiettivi stanno in testa.

Il risultato è che nessuno — né un'app né un professionista consultato ogni tre mesi — ha mai il quadro completo nel momento in cui serve una decisione. Domande banali come *"oggi voglio fare 10 km, come mi preparo, considerando che sono in deficit e che la ferritina era bassa a maggio?"* non hanno oggi nessun posto dove essere poste.

---

## 3. Utente e vincoli

| Aspetto | Decisione |
|---|---|
| **Utenti** | Uno solo: l'autore. Nessuna multi-tenancy, nessun onboarding, nessun account di terzi. |
| **Implicazione privacy** | Non c'è trattamento di dati sanitari altrui: nessun obbligo GDPR verso terzi, nessuna informativa, nessun DPO. Restano i doveri verso sé stessi (backup, cifratura, controllo dell'hosting). |
| **Implicazione regolatoria** | Nessun agente prescrive: propone. La decisione finale è sempre dell'utente su sé stesso. Fuori dal perimetro di dispositivo medico e di esercizio abusivo della professione. |
| **Implicazione di prodotto** | Nessun compromesso per il "utente medio". L'interfaccia può essere spigolosa se è efficiente. |

---

## 4. Principi guida

Questi principi risolvono in anticipo i conflitti di design. In caso di dubbio durante l'implementazione, si torna qui.

**P1 — Nessun agente decide. Si discute, poi decido io.**
Il canale condiviso funziona come una conversazione tra amici esperti: ognuno porta il suo punto di vista, i disaccordi restano visibili e non vengono appianati da un'autorità artificiale. Non esiste un agente coordinatore né una gerarchia di veto. La sintesi è un atto dell'utente.

**P2 — Solo l'utente "committa" un piano.**
Nessun agente può modificare un piano attivo in autonomia. Le proposte restano proposte finché non vengono approvate esplicitamente. Il piano attivo è sempre uno solo e sempre noto.

**P3 — Il prescritto e l'eseguito sono due cose diverse e nessuna delle due sovrascrive l'altra.**
La scheda dice 4×20 a 20 kg. Il log dice 3×15 a 20 kg. Entrambi restano, per sempre. La distanza tra i due è il segnale più importante del sistema.

**P4 — Il database è la verità, le superfici sono viste.**
Buzz e l'app sono due modi diversi di guardare e modificare lo stesso stato. Nessuna informazione esiste solo dentro una chat.

**P5 — L'attrito va messo dove c'è tempo, non dove non c'è.**
In palestra si logga in due tap. Il contesto e le motivazioni si recuperano dopo, sul divano, in conversazione.

---

## 5. Architettura di sistema

Tre livelli, con un confine netto tra loro.

```
┌─────────────────────────┐     ┌─────────────────────────┐
│         BUZZ            │     │       APP (PWA)         │
│   "il tavolo di         │     │   "la palestra e        │
│    consulto"            │     │    la cucina"           │
│                         │     │                         │
│ • si discute            │     │ • scheda di oggi        │
│ • si propone            │     │ • log delle serie       │
│ • si approva (/approva) │     │ • macro del giorno      │
│ • check settimanale     │     │ • storico e trend       │
│ • domande di chiarim.   │     │ • badge proposte        │
└───────────┬─────────────┘     └───────────┬─────────────┘
            │                                │
            │        lettura / scrittura     │
            └───────────────┬────────────────┘
                            ▼
              ┌───────────────────────────┐
              │   DATABASE (la verità)    │
              │                           │
              │ piani · log · metriche ·  │
              │ marker ematici · obiettivi│
              └─────────────┬─────────────┘
                            ▲
              ┌─────────────┴─────────────┐
              │      INGESTIONE           │
              │                           │
              │ connettori (apple health) │
              │ cartella Drive (CSV, PDF) │
              └───────────────────────────┘
```

### 5.1 Perché Buzz e non una chat costruita da zero

Buzz (Block, luglio 2026) è un workspace open source in cui umani e agenti condividono gli stessi canali, ciascuno con identità crittografica propria e con un log firmato di chi ha detto cosa. Regala già fatti: il multi-agente in un canale, i DM col singolo agente, il threading, l'identità e l'audit trail. Ricostruire tutto questo dentro un'app personale sarebbe il grosso del lavoro, e non è il lavoro interessante.

### 5.2 Perché comunque serve un'app

Buzz non è utilizzabile in palestra. Il log della forza — *"panca piana: prevista 4×20 a 20 kg, fatta 3×15"* — è un'operazione ad alta frequenza, a bassa attenzione, spesso senza connettività, che va fatta in due tap tra una serie e l'altra. Scriverlo in chat non accadrà mai, e senza quel dato il personal trainer è cieco esattamente sulla metà del suo lavoro.

### 5.3 Confine tra le due superfici

| | Buzz | App |
|---|---|---|
| **Momento d'uso** | Divano, con calma | Palestra, cucina, di corsa |
| **Cosa ci fai** | Discuti, proponi, approvi | Consulti ed esegui |
| **Chi scrive** | Gli agenti (proposte), tu (decisioni) | Tu (log), il sistema (piano attivo) |
| **Chat nell'app?** | — | **No** in v1. Solo un badge passivo con link al thread. |
| **Piano attivo modificabile?** | Sì, via `/approva` | No, sola lettura |

---

## 6. Il ciclo centrale: prescrizione → esecuzione → revisione

Questo è il prodotto. Tutto il resto è infrastruttura per farlo girare.

**1. Prescrizione.** In Buzz si discute un obiettivo (*"un piano che mi porti alla maratona in 6 mesi"*). Gli agenti dialogano tra loro e con l'utente. Ne esce una proposta di piano.

**2. Commit.** L'utente approva con `/approva`. Il piano diventa la versione attiva nel database, con data, autore, motivazione e link al thread di origine. La versione precedente resta archiviata.

**3. Esecuzione.** L'app mostra la sessione di oggi e i macro di oggi, presi dal piano attivo. L'utente esegue e logga.

**4. Deviazione.** Il log registra ciò che è realmente accaduto. Il sistema calcola lo scostamento rispetto al prescritto: volume, intensità, aderenza percentuale.

**5. Chiarimento.** Se lo scostamento supera una soglia, l'agente competente scrive in Buzz **una** domanda, entro un'ora dalla fine della sessione, mentre la memoria è fresca. *"Hai chiuso la panca a 3×15: era troppo pesante o avevi poco tempo?"*

**6. Revisione.** Al check settimanale (lunedì mattina) gli agenti leggono i dati dei sette giorni e propongono aggiustamenti. Si torna al punto 1.

---

## 7. Gli agenti

### 7.1 Roster

| Agente | v1 | Ruolo | Limiti espliciti |
|---|---|---|---|
| **Personal trainer** | ✅ | Schede palestra/corsa/nuoto, periodizzazione, progressione dei carichi, piani obiettivo | Non valuta dolore o infortunio: se emergono, passa la palla |
| **Nutrizionista** | ✅ | Macro, fasi di bulk/cut, timing dei pasti, adattamento all'allenamento | Non prescrive integratori senza esami recenti; non tratta patologie |
| **Fisioterapista** | v2 | Lettura dei fastidi, carichi da evitare, mobilità | Non diagnostica; segnala quando serve un professionista reale |
| **Medico** | v2 | Lettura dei marker ematici, contesto generale, segnalazione di valori fuori range | **Solo parere.** Nessuna diagnosi, nessun dosaggio, nessuna terapia. Su segnali rossi, un solo output: vai da un medico vero |

La v1 include **solo trainer e nutrizionista**. Sono i due che generano dati continui e quindi gli unici che possono chiudere il ciclo. Fisio e medico sono conversazionalmente interessanti ma a bassa frequenza: aggiungerli prima che il ciclo funzioni gonfia lo scope senza validare nulla.

### 7.2 Da dove viene la competenza

Tre livelli possibili:

1. **Conoscenza generica del modello** — gratis, indifferenziata.
2. **Persona curata** — un documento di istruzioni lungo e specifico per ogni agente.
3. **Corpus proprietario ricercabile** — documenti selezionati dall'utente, citati nelle risposte.

**In v1 si arriva al livello 2.** È il 90% della differenza percepita e costa solo tempo di scrittura. Il livello 3 si aggiunge in v2, partendo dall'agente che all'uso è risultato più vago.

### 7.3 Struttura della "persona" di ogni agente

Ogni agente ha un documento con queste sezioni obbligatorie:

- **Metodo e scuola di pensiero** — a quale approccio aderisce, esplicitamente. Un nutrizionista "flessibile" e uno "rigido" danno risposte diverse alla stessa domanda: la scelta va fatta, non lasciata al caso.
- **Cosa fa sempre** — le domande che pone prima di rispondere, i dati che consulta obbligatoriamente prima di proporre qualcosa.
- **Cosa non fa mai** — i confini duri. È la sezione che rende il "medico" accettabile.
- **Quando passa la palla** — le condizioni in cui deve tirare in ballo un altro agente o dire "questo va chiesto a un umano".
- **Tono** — come parla, quanto è diretto, se contraddice o accompagna.
- **Tool a disposizione** — quali letture e scritture sul database può fare.

### 7.4 Tool degli agenti

Letture: piano attivo, storico piani, log allenamenti, metriche corporee, macro registrati, serie storiche dei marker ematici, obiettivi, note.
Scritture: **proposte** di piano, domande di chiarimento, annotazioni sul log.
Mai: modifica diretta di un piano attivo, cancellazione di dati storici.

---

## 8. Modello dati

Strutture concettuali; lo schema esatto va definito in fase tecnica.

### 8.1 Piani (il prescritto)

```
piano
  id, tipo (allenamento | nutrizione), versione, stato (proposta | attivo | archiviato)
  autore_agente, data_creazione, data_attivazione
  motivazione, riferimento_thread_buzz
  contenuto (struttura del piano)
  piano_precedente_id
```

Un solo piano attivo per tipo alla volta. Le versioni non si cancellano mai: la storia dei piani è ciò che permette di rispondere a "questo approccio ha funzionato?".

```
sessione_prescritta
  id, piano_id, data_prevista, tipo (palestra | corsa | nuoto | ...)
  esercizi[] → { nome, serie, ripetizioni, carico, recupero, note }
```

### 8.2 Log (l'eseguito)

```
sessione_eseguita
  id, sessione_prescritta_id (opzionale: si può fare anche ciò che non era previsto)
  data_effettiva, durata, note_libere, rpe_sessione (opzionale)
  serie_eseguite[] → { esercizio, serie_n, ripetizioni, carico, note }
```

**Il log non tocca mai la sessione prescritta.** Lo scostamento è calcolato, non memorizzato in modo distruttivo:

```
scostamento (calcolato)
  volume_prescritto vs volume_eseguito
  aderenza_% (sessioni fatte / previste, serie fatte / previste)
  variazione_carico per esercizio
  esercizi_saltati[]
```

### 8.3 Metriche e salute

```
metrica_corporea
  data, tipo (peso | circonferenza | massa_grassa | ...), valore, fonte

marker_ematico
  data_prelievo, marker, valore, unità, range_min, range_max, fuori_range (bool)
  documento_origine_id   ← link al PDF su Drive

documento
  id, tipo (referto | export | foto), percorso_drive, data, metadati_estratti
```

I marker ematici **sono serie temporali e vanno nel database**, anche se il PDF originale resta archiviato su Drive. Ferritina, vitamina D e colesterolo nel tempo sono esattamente il tipo di trend su cui medico e nutrizionista devono ragionare: lasciarli dentro un PDF significa che nessuno li guarderà mai.

### 8.4 Obiettivi

```
obiettivo
  descrizione, tipo (evento | metrica | abitudine)
  data_target, stato, metrica_di_successo
  es. "maratona sotto le 4h il 15 marzo 2027"
```

---

## 9. Ingestione dei dati

**Regola generale:** connettore automatico dove esiste; altrimenti cartella su Drive.

### 9.1 Connettori automatici

| Fonte | Priorità | Cosa porta |
|---|---|---|
| Garmin o Strava | **v1, obbligatorio** | Corse, nuotate, HR, passo, distanza, carico |

È l'unica fonte ad alta frequenza dove l'inserimento manuale è insostenibile, ed è l'unica integrazione che vale la pena costruire prima di aver validato il resto.

### 9.2 Cartella Drive

Punto di atterraggio per tutto il resto. Contiene due soli formati:

- **CSV** (export da app alimentari, bilance, ecc.) → un job di normalizzazione legge i nuovi file, estrae le metriche e le scrive nel database. Il file grezzo resta come archivio.
- **PDF degli esami del sangue** → il documento resta consultabile come tale, ma i marker vengono estratti e scritti nel database come serie temporale, con link al referto di origine.

### 9.3 App (PWA)

La terza fonte, e per la forza è **l'unica**: le serie in palestra non esistono da nessun'altra parte.

---

## 10. Superficie A — Buzz

### 10.1 Struttura dei canali

- **`#consulto`** — il canale condiviso. Tutti gli agenti presenti, discutono tra loro e con l'utente. È qui che si costruiscono i piani.
- **DM con ogni agente** — domande veloci a un singolo specialista, senza il rumore degli altri.
- **`#log`** (opzionale) — canale tecnico dove il sistema pubblica gli eventi: nuova sessione loggata, nuovo referto importato, piano attivato.

### 10.2 Comandi

| Comando | Effetto |
|---|---|
| `/approva` | In risposta a una proposta: la rende il piano attivo, versionandola |
| `/rifiuta [motivo]` | Archivia la proposta, il motivo resta come contesto per il futuro |
| `/attivo [tipo]` | Mostra il piano attualmente in vigore |
| `/storico [tipo]` | Elenca le versioni precedenti con le motivazioni |

Il comando di approvazione è il punto in cui il sistema si assume un impegno. Va reso deliberato e inequivocabile: mai desumibile da un "ok va bene" in linguaggio naturale.

### 10.3 Interventi proattivi degli agenti

Tre classi, e nessuna oltre queste.

**A. Check settimanale** — lunedì mattina, nel canale condiviso. Gli agenti leggono i sette giorni e producono: cosa dicono i dati, come procede la fase in corso, cosa proporrebbero. Non è un report automatico, è l'inizio di una conversazione.

**B. Anomalie nei dati** — soglie esplicite, non "qualcosa di strano":

| Trigger | Soglia indicativa |
|---|---|
| Aderenza settimanale bassa | < 60% delle sessioni previste |
| Calo di volume improvviso | −25% sul rolling di 2 settimane |
| Variazione di peso fuori trend | > 1,5% in 7 giorni |
| Marker ematico fuori range | qualsiasi valore fuori dai riferimenti |
| Note contenenti segnali di dolore | rilevamento su parole chiave |

**C. Chiarimento post-sessione** — entro un'ora dalla fine, **una sola domanda**, solo se lo scostamento supera soglia. Se non ricevi risposta, la domanda decade e confluisce nel check di lunedì.

**Tetto globale:** massimo 3 interventi proattivi non richiesti a settimana, escluso il check del lunedì. Superato il tetto, tutto slitta al lunedì. Senza questo limite il sistema diventa un'app che rimprovera, e le app che rimproverano si silenziano.

---

## 11. Superficie B — App (PWA)

### 11.1 Tecnologia

**Progressive Web App, mobile-first, offline-first.** Installabile sulla schermata home, un solo progetto per iOS e Android, deploy immediato, nessun App Store. Il log viene scritto in locale e sincronizzato quando torna la connettività — vincolo non negoziabile, perché le palestre nei seminterrati sono la norma.

Rinuncia consapevole: nessun accesso ad Apple Health né all'Apple Watch. Se in futuro il logging dal polso diventa la vera esigenza, il database e gli agenti restano identici e si riscrive solo l'interfaccia.

### 11.2 Schermate v1

**Oggi** — la schermata di apertura. Cosa devi fare oggi: la sessione prescritta e i macro del giorno. Un tap per iniziare.

**Sessione in corso** — la scheda, esercizio per esercizio. Per ogni serie: il prescritto in chiaro, e un tap per confermare "fatta come previsto". Se cambi qualcosa, modifichi ripetizioni o carico direttamente. Un campo **note libero** per sessione, dove scrivere quello che vuoi senza schemi. RPE di sessione opzionale, un solo numero.

Nessun campo obbligatorio oltre ai numeri. Il "perché" di una deviazione non viene chiesto qui: lo recuperano gli agenti dopo, in conversazione. Questo è il principio P5 in azione.

**Nutrizione** — i macro target del giorno dal piano attivo, e cosa hai registrato. In v1 può essere in sola lettura, con i consuntivi che arrivano dal CSV.

**Storico** — trend di peso, volume di allenamento, aderenza. Poche viste, quelle che guardi davvero.

**Badge proposte** — un avviso passivo: *"1 proposta in attesa"*, con link al thread di Buzz. Nessuna logica di approvazione nell'app: si approva solo in chat. Serve unicamente a evitare di seguire per tre giorni un piano che è già stato messo in discussione.

---

## 12. Scope

### 12.1 Dentro la v1

La v1 è considerata finita quando **questo scenario funziona end-to-end**:

> Chiedo in `#consulto` un piano che mi porti alla maratona in 6 mesi. Trainer e nutrizionista ne discutono tra loro e con me. Approvo con `/approva`. Da quel momento l'app mi dice ogni giorno cosa fare. Le corse entrano da sole da Garmin, le sedute di palestra le logo nell'app. Se salto o taglio qualcosa, mi arriva una domanda. Ogni lunedì mattina mi dicono come sta andando e cosa cambierebbero.

Questo scenario tocca ogni componente dell'architettura. Se regge, gli agenti successivi sono in gran parte copia-incolla.

Include quindi:

- 2 agenti (trainer, nutrizionista) con persona curata
- canale condiviso + DM su Buzz
- comandi `/approva` e `/rifiuta` con versionamento dei piani
- database con piani, log, metriche, marker
- connettore Garmin/Strava
- cartella Drive con normalizzazione CSV e import PDF esami
- PWA offline-first: Oggi, Sessione, Storico, badge
- check settimanale + trigger di anomalia + chiarimento post-sessione

### 12.2 Fuori dalla v1 (esplicitamente)

- agente medico e agente fisioterapista
- corpus documentale ricercabile con citazioni (livello 3)
- ricerca web da parte degli agenti
- app nativa, Apple Watch, HealthKit
- chat dentro l'app
- registrazione dei pasti dentro l'app
- foto di progresso, integrazione bilancia smart
- qualunque forma di multi-utente o condivisione

---

## 13. Metriche di successo

Per uno strumento personale la metrica non è l'engagement, è: **lo sto ancora usando fra tre mesi e mi sta cambiando le decisioni?**

| Metrica | Soglia di successo a 90 giorni |
|---|---|
| Sessioni loggate nell'app / sessioni fatte | > 80% |
| Proposte degli agenti effettivamente approvate | > 40% (se troppo basse, gli agenti sono scollegati dalla realtà; se vicine al 100%, non stanno dicendo niente di scomodo) |
| Risposte alle domande di chiarimento | > 60% |
| Check settimanali letti | > 10 su 13 |
| Decisioni cambiate grazie al sistema | almeno 3 casi riconoscibili, annotati |

Il fallimento più probabile non è tecnico: è che dopo cinque settimane smetti di loggare. Va misurato per primo.

---

## 14. Rischi

| Rischio | Gravità | Mitigazione |
|---|---|---|
| **Dati sanitari in un log firmato e replicato.** Buzz è costruito su Nostr: i messaggi finiscono in un event log immutabile. Anche tenendo i dati nel database, le *conversazioni* parlano del tuo corpo, dei tuoi esami e delle tue debolezze. | **Alta** | Da chiarire prima di partire: modello di cifratura dei canali privati, e se usare l'istanza ospitata su buzz.xyz o auto-ospitarne una. Per dati di questa natura l'auto-hosting è l'ipotesi di lavoro predefinita. **Punto bloccante da verificare.** |
| **Piattaforma nata da due settimane.** API instabili, funzionalità che cambiano, progetto che potrebbe non consolidarsi. | Media | Il principio P4 è la difesa: se la verità sta nel database, cambiare superficie di chat costa settimane, non anni. Nessuna logica di business dentro Buzz. |
| **Abbandono del logging.** Il rischio numero uno di qualunque app di tracking. | **Alta** | Attrito minimo (P5), offline-first, nessun campo obbligatorio. Metrica monitorata dal giorno uno. |
| **Agenti indistinguibili.** Quattro cappelli sullo stesso modello che dicono le stesse cose. | Media | Persona curata con metodo esplicito e sezione "cosa non fa mai". Se all'uso restano vaghi, si passa al livello 3 sul più debole. |
| **Sovraccarico di notifiche.** | Media | Tetto di 3 interventi settimanali, soglie numeriche esplicite, decadimento delle domande senza risposta. |
| **Il "medico" scivola nella diagnosi.** | Media (v2) | Confini duri nella persona, output obbligato verso il professionista umano sui segnali rossi, e il vincolo strutturale P1: nessun agente decide. |
| **Deriva dei dati.** Parser CSV che si rompono quando l'app di origine cambia export. | Bassa | Validazione all'import e notifica in `#log` in caso di file non parsabile, invece di scrittura silenziosa di dati sbagliati. |

---

## 15. Domande aperte

Da risolvere prima o durante la fase tecnica.

1. **Buzz auto-ospitato o buzz.xyz?** Dipende dal modello di cifratura dei canali privati. È il primo accertamento da fare, ed è potenzialmente bloccante.
2. **Come si autenticano gli agenti verso il database?** Ogni agente ha identità propria su Buzz: quell'identità va mappata a permessi distinti sui dati (chi può scrivere cosa).
3. **Quale database e dove.** Va scelto tenendo conto che deve essere raggiungibile sia dagli agenti che dalla PWA, con sincronizzazione offline.
4. **Garmin o Strava?** Dipende dai dispositivi realmente in uso e dalla qualità dei rispettivi accessi ai dati.
5. **Backup e cifratura a riposo** dei dati sanitari. Da definire prima di caricare il primo referto.
6. **Cosa succede a un piano quando lo si abbandona a metà?** Serve un concetto di "piano interrotto" distinto da "piano completato", altrimenti lo storico mente.
7. **Nome del progetto.**

---

## 16. Roadmap indicativa

| Fase | Contenuto | Esito |
|---|---|---|
| **0 — Accertamenti** | Modello privacy di Buzz, scelta hosting, prova pratica di creazione di un agente | Via libera o cambio di piattaforma |
| **1 — Fondamenta** | Database, schema piani/log, tool di lettura e scrittura per gli agenti | Un agente sa leggere e scrivere lo stato |
| **2 — Prima conversazione** | Trainer e nutrizionista con persona curata, canale condiviso, `/approva` | Il piano maratona viene generato e committato |
| **3 — Ingestione** | Connettore Garmin/Strava, cartella Drive, normalizzazione CSV, import referti | Gli agenti ragionano su dati veri |
| **4 — App** | PWA: Oggi, Sessione, Storico, sincronizzazione offline | Il ciclo si chiude |
| **5 — Ritmo** | Check settimanale, trigger di anomalia, domande di chiarimento | Il sistema inizia a farsi vivo da solo |

---

## Appendice — Registro delle decisioni

Le quattordici scelte prese in fase di intervista, con la motivazione.

| # | Decisione | Perché |
|---|---|---|
| 1 | Utente singolo, uso personale | Elimina compliance e responsabilità professionale; permette di validare in settimane |
| 2 | Buzz = interfaccia, database = verità | Query storiche vere, dati fuori dall'event log, nessun lock-in |
| 3 | Quattro famiglie di dati disponibili | Sport, alimentazione, referti, misure manuali |
| 4 | Connettori dove possibile, cartella Drive altrove | Pragmatico: non costruire idraulica prima di aver validato il valore |
| 5 | CSV normalizzati nel database, PDF archiviati ma con marker estratti | I marker sono serie temporali, non documenti |
| 6 | Nessun coordinatore, nessuna gerarchia: "chat tra amici" | Sposta il prodotto da motore di decisioni a tavolo di consulto, e azzera il rischio |
| 7 | Solo l'utente committa, i piani sono versionati | Il piano attivo è sempre uno, noto e motivato |
| 8 | Check settimanale + anomalie + chiarimenti, con tetto | Alto segnale, basso rumore |
| 9 | Persona curata in v1, corpus documentale in v2 | Il 90% della differenza a un quarto del costo |
| 10 | v1 = 2 agenti + ciclo maratona completo | Fetta verticale che tocca ogni componente |
| 11 | App PWA offline-first, punto di ingestione della forza | La chat non è usabile in palestra |
| 12 | Prescritto ≠ eseguito, mai sovrascritti | La differenza tra i due è il segnale che alimenta tutto |
| 13 | Log veloce + note libere; il "perché" lo chiedono gli agenti | Attrito dove c'è tempo, non dove non ce n'è |
| 14 | Approvazione via `/approva` in Buzz, badge passivo nell'app | Un solo luogo di decisione, con un promemoria dove ti alleni |

Per lanciare buzz: cd "/Applications/Self Developed Applications/wellbeing-agents/buzz" && ./start-buzz.sh
