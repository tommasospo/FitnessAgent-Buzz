# Test di accettazione — Fase 1

## Scenario

In `#consulto`, scrivi:

> "Facciamo un piano che mi porti alla maratona in 6 mesi"

## Cosa deve succedere per considerare la Fase 1 riuscita

Non basta che entrambi gli agenti rispondano. Deve esserci uno **scambio reale**, osservabile in questi segnali concreti:

1. **Il Nutrizionista cita qualcosa di specifico detto dal Trainer** — un numero, un volume, una scelta — non un discorso generico sui macro per la corsa scollegato dal messaggio del Trainer.
2. **Almeno un disaccordo o un'obiezione esplicita** tra i due, visibile nel canale (non appianato, non "va bene tutto"). Dato il PRD, è più probabile che sia il Nutrizionista a sollevarlo (deficit calorico vs volume di corsa in aumento), coerente con la persona che gli abbiamo dato.
3. **Il Trainer fa domande prima di proporre un piano numerico** (giorni disponibili, esperienza, eventuali dolori) invece di sparare subito una tabella.
4. **Nessuno dei due inventa dati che non esistono** — in questa fase entrambi devono dire esplicitamente "non ho i tuoi dati reali, dimmeli tu" quando servirebbe un numero che non è stato fornito in conversazione.
5. Rileggendo la conversazione, si deve percepire un **botta e risposta**, non due monologhi pubblicati in sequenza nello stesso canale.

## Se non succede

Il problema è nelle persone (`agents/*.persona.md`), non nella piattaforma. Prima di toccare altro, controlla in quest'ordine:

- **Se i due agenti non si leggono a vicenda**: verifica che entrambi siano davvero membri di `#consulto` (non solo in DM separati), e prova a taggare esplicitamente l'altro agente nel messaggio per forzare la lettura reciproca (es. "@Nutrizionista cosa ne pensi di quello che ha detto il Trainer?"). Se con il tag funziona ma senza no, il problema è nel meccanismo di attivazione dell'agente (quali messaggi legge/a cui risponde), non nel testo della persona.
- **Se rispondono ma senza mai contraddirsi**: la sezione "Tono" e "Quando passa la palla" delle persone va resa più tagliente — probabilmente il modello sta smussando il disaccordo di default. Prova ad aggiungere un esempio concreto di disaccordo nel testo della persona.
- **Se inventano dati che non hanno**: rinforza la sezione "Cosa fai sempre" ribadendo il divieto di inventare numeri, con un esempio esplicito di come rifiutarsi ("non ho i tuoi dati, dimmeli tu" invece di stimare un numero plausibile).
- **Se sono generici e intercambiabili**: il problema è nel "Metodo e scuola di pensiero" — va reso più specifico e meno riassumibile in una frase da manuale.

## Cosa NON è nello scope di questo test

- Nessuna verifica di correttezza tecnica del piano proposto (non stiamo validando se il piano di allenamento è "giusto", solo se la conversazione tra agenti funziona come formato).
- Nessuna verifica di `/approva` o di persistenza del piano: non esiste ancora un piano da approvare in questa fase, solo una discussione.
- Nessun test con dati reali: se un agente chiede un dato che normalmente verrebbe da Garmin o da un log allenamenti, rispondi tu a mano nella conversazione, è previsto.
