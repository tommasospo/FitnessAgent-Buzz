import { z } from 'zod'
import { supabase } from './supabase.js'
import { env } from './env.js'

// Tool disponibili per gli agenti Buzz (PT, Nutrizionista) — PRD §7.4.
//
// Letture: piano attivo, storico piani, log allenamenti, metriche corporee,
// marker ematici, obiettivi, note.
// Scritture: proposte di piano (mai attive), domande di chiarimento / anomalie
// (con tetto), annotazioni sul log.
// Mai esposto come tool: update/delete su piano, sessione_prescritta,
// sessione_eseguita, metrica_corporea, marker_ematico — l'agente non può
// modificare un piano attivo né cancellare dati storici, per costruzione.

// Molti modelli, per un campo facoltativo che non vogliono valorizzare, mandano `null` invece di
// ometterlo del tutto — ma z.optional()/z.default() da soli accettano solo `undefined`, non
// `null`. Il risultato è che la chiamata fallisce la validazione: l'errore torna al modello come
// stringa dentro il risultato del tool (non un'eccezione, quindi invisibile nei log del bot), e il
// modello può anche non accorgersene e riferire che l'azione è andata a buon fine quando invece
// non ha scritto nulla. opz()/opzD() rendono un campo tollerante a entrambi.
function opz<T extends z.ZodTypeAny>(schema: T) {
  return schema.nullable().optional().transform((v) => v ?? undefined)
}
function opzD<T extends z.ZodTypeAny, D>(schema: T, valorePredefinito: D) {
  return schema.nullable().optional().transform((v) => v ?? valorePredefinito)
}

const esercizioSchema = z
  .object({
    nome: z.string(),
    serie: z.number().int().positive(),
    ripetizioni: opz(z.number().int().positive()),
    secondi: opz(z.number().int().positive()),
    carico: opz(z.number()),
    recupero_secondi: opz(z.number().int()),
    tecnica: opz(
      z
        .enum(['superset', 'piramidale', 'stripping', 'cedimento'])
        .describe(
          "Etichetta della tecnica, mostrata come badge in app. Solo un tag: la progressione numerica " +
            "(es. i pesi di un piramidale, i drop di uno stripping) va scritta in `note`, non c'è uno " +
            "schema per-serie a parte. Per un superset, tagga con 'superset' TUTTI gli esercizi del blocco " +
            "e scrivili CONSECUTIVI nell'array `esercizi`: l'app li raggruppa in base all'adiacenza, non " +
            "serve un id di gruppo.",
        ),
    ),
    note: opz(z.string()),
  })
  .refine((e) => (e.ripetizioni !== undefined) !== (e.secondi !== undefined), {
    message: 'Specifica esattamente uno tra ripetizioni e secondi (a seconda che l\'esercizio sia a ripetizioni o a tempo).',
  })

const memoriaCategoriaSchema = z.enum(['vincolo_fisico', 'preferenza', 'contesto_vita', 'stile_comunicazione', 'altro'])

const sessionePrescrittaInputSchema = z.object({
  giorno_numero: z
    .number()
    .int()
    .positive()
    .describe(
      "Posizione della sessione nello split che si ripete (1, 2, 3, ...) — NON una data. L'utente sceglie da " +
        "solo quando allenarsi: la sessione 'Giorno 1' è la prossima volta che si allena dopo aver completato " +
        "l'ultima sessione dello split, non un giorno di calendario fisso.",
    ),
  tipo: z.enum(['palestra', 'corsa', 'nuoto', 'bici', 'altro']),
  esercizi: opzD(z.array(esercizioSchema), []),
  durata_minuti_suggerita: opz(
    z
      .number()
      .int()
      .positive()
      .describe(
        "Per sessioni non da palestra: durata suggerita in minuti. Facoltativa — lasciala vuota per " +
          "un'indicazione volutamente generica (es. 'una corsa a settimana', senza tempi o intervalli).",
      ),
  ),
  distanza_km_suggerita: opz(z.number().positive().describe('Come durata_minuti_suggerita ma in km, facoltativa.')),
  zona_frequenza_cardiaca: opz(
    z
      .string()
      .describe(
        "Indicazione di intensità mostrata IN SCHEDA (non solo a voce in chat), es. \"128-145 bpm (Zona 2)\". " +
          'Usala quando daresti un\'indicazione di intensità: ha più valore lì che in una frase in chat che si perde.',
      ),
  ),
  note: opz(z.string().describe("Nota libera a livello di sessione (non del singolo esercizio) — utile soprattutto per sessioni senza esercizi (corsa/nuoto/bici).")),
})

export const tools = [
  {
    name: 'leggi_piano_attivo',
    description:
      "Legge il piano attivo di un tipo (allenamento o nutrizione), incluse le sessioni prescritte se è di allenamento. Ritorna null se non c'è nessun piano attivo di quel tipo.",
    inputSchema: {
      tipo: z.enum(['allenamento', 'nutrizione']),
    },
    handler: async ({ tipo }: { tipo: 'allenamento' | 'nutrizione' }) => {
      const { data: piano, error } = await supabase
        .from('piano')
        .select('*')
        .eq('tipo', tipo)
        .eq('stato', 'attivo')
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!piano) return { piano: null, sessioni_prescritte: [] }

      if (tipo === 'allenamento') {
        const { data: sessioni, error: errSessioni } = await supabase
          .from('sessione_prescritta')
          .select('*')
          .eq('piano_id', piano.id)
          .order('giorno_numero', { ascending: true })
        if (errSessioni) throw new Error(errSessioni.message)
        return { piano, sessioni_prescritte: sessioni }
      }

      return { piano, sessioni_prescritte: [] }
    },
  },
  {
    name: 'leggi_storico_piani',
    description: 'Elenca le versioni precedenti (e la proposta corrente, se esiste) di un tipo di piano, più recenti prima.',
    inputSchema: {
      tipo: z.enum(['allenamento', 'nutrizione']),
      limite: opzD(z.number().int().positive().max(50), 10),
    },
    handler: async ({ tipo, limite }: { tipo: 'allenamento' | 'nutrizione'; limite: number }) => {
      const { data, error } = await supabase
        .from('piano')
        .select('*')
        .eq('tipo', tipo)
        .order('data_creazione', { ascending: false })
        .limit(limite)
      if (error) throw new Error(error.message)
      return data
    },
  },
  {
    name: 'leggi_log_allenamenti',
    description: 'Legge le sessioni effettivamente eseguite (il log), più recenti prima, con filtro opzionale di data.',
    inputSchema: {
      da: opz(z.string().describe('Data ISO minima (inclusa)')),
      a: opz(z.string().describe('Data ISO massima (inclusa)')),
      limite: opzD(z.number().int().positive().max(100), 20),
    },
    handler: async ({ da, a, limite }: { da?: string; a?: string; limite: number }) => {
      let query = supabase
        .from('sessione_eseguita')
        .select('*')
        .order('data_effettiva', { ascending: false })
        .limit(limite)
      if (da) query = query.gte('data_effettiva', da)
      if (a) query = query.lte('data_effettiva', a)
      const { data, error } = await query
      if (error) throw new Error(error.message)
      return data
    },
  },
  {
    name: 'leggi_metriche_corporee',
    description: 'Legge la serie storica delle metriche corporee (peso, circonferenze, massa grassa, ...).',
    inputSchema: {
      tipo: opz(z.enum(['peso', 'circonferenza', 'massa_grassa', 'altro'])),
      da: opz(z.string()),
      a: opz(z.string()),
      limite: opzD(z.number().int().positive().max(200), 50),
    },
    handler: async ({
      tipo,
      da,
      a,
      limite,
    }: {
      tipo?: 'peso' | 'circonferenza' | 'massa_grassa' | 'altro'
      da?: string
      a?: string
      limite: number
    }) => {
      let query = supabase.from('metrica_corporea').select('*').order('data', { ascending: false }).limit(limite)
      if (tipo) query = query.eq('tipo', tipo)
      if (da) query = query.gte('data', da)
      if (a) query = query.lte('data', a)
      const { data, error } = await query
      if (error) throw new Error(error.message)
      return data
    },
  },
  {
    name: 'leggi_marker_ematici',
    description: 'Legge la serie storica dei marker ematici (es. ferritina, vitamina D, colesterolo), con flag fuori_range.',
    inputSchema: {
      marker: opz(z.string().describe('Nome esatto del marker, es. "ferritina"')),
      da: opz(z.string()),
      a: opz(z.string()),
      limite: opzD(z.number().int().positive().max(200), 50),
    },
    handler: async ({
      marker,
      da,
      a,
      limite,
    }: {
      marker?: string
      da?: string
      a?: string
      limite: number
    }) => {
      let query = supabase
        .from('marker_ematico')
        .select('*')
        .order('data_prelievo', { ascending: false })
        .limit(limite)
      if (marker) query = query.eq('marker', marker)
      if (da) query = query.gte('data_prelievo', da)
      if (a) query = query.lte('data_prelievo', a)
      const { data, error } = await query
      if (error) throw new Error(error.message)
      return data
    },
  },
  {
    name: 'leggi_obiettivi',
    description: "Legge gli obiettivi dell'utente (evento, metrica, abitudine) con stato e scadenza.",
    inputSchema: {},
    handler: async () => {
      const { data, error } = await supabase.from('obiettivo').select('*').order('data_target', { ascending: true })
      if (error) throw new Error(error.message)
      return data
    },
  },
  {
    name: 'leggi_profilo_utente',
    description:
      "Legge i dati generali che l'utente ha inserito lui stesso nell'app (altezza, data di nascita, sesso, " +
      "livello di esperienza, allergie/intolleranze, infortuni pregressi, note) così da non doverli richiedere " +
      "di nuovo in chat. Il peso NON è qui: è una serie storica, usa leggi_metriche_corporee. Ritorna null se " +
      "l'utente non ha ancora compilato nulla.",
    inputSchema: {},
    handler: async () => {
      const { data, error } = await supabase.from('profilo_utente').select('*').maybeSingle()
      if (error) throw new Error(error.message)
      return data
    },
  },
  {
    name: 'leggi_note_agente',
    description: 'Legge le annotazioni lasciate dagli agenti sul log o su altri record, più recenti prima.',
    inputSchema: {
      destinatario_tipo: opz(z.string()),
      destinatario_id: opz(z.string().uuid()),
      limite: opzD(z.number().int().positive().max(200), 50),
    },
    handler: async ({
      destinatario_tipo,
      destinatario_id,
      limite,
    }: {
      destinatario_tipo?: string
      destinatario_id?: string
      limite: number
    }) => {
      let query = supabase.from('nota_agente').select('*').order('created_at', { ascending: false }).limit(limite)
      if (destinatario_tipo) query = query.eq('destinatario_tipo', destinatario_tipo)
      if (destinatario_id) query = query.eq('destinatario_id', destinatario_id)
      const { data, error } = await query
      if (error) throw new Error(error.message)
      return data
    },
  },
  {
    name: 'proponi_piano',
    description:
      "Crea una NUOVA PROPOSTA di piano (mai attiva: solo l'utente può attivarla, dall'app — sezione Schede, non in chat). " +
      'Calcola automaticamente la versione e il collegamento al piano precedente. Puoi allegare subito le sessioni prescritte (per allenamento).',
    inputSchema: {
      tipo: z.enum(['allenamento', 'nutrizione']),
      contenuto: z.record(z.any()).describe(
        'Struttura libera del piano. Per nutrizione: { macro: { kcal, proteine_g, carboidrati_g, grassi_g }, note }.',
      ),
      motivazione: z.string(),
      durata_settimane: opz(
        z
          .number()
          .int()
          .positive()
          .describe(
            "Durata del piano in settimane a partire da quando l'utente lo attiva dall'app (non da ora). " +
              'Facoltativa: lascia vuoto solo se il piano non ha davvero una scadenza pensata.',
          ),
      ),
      riferimento_thread_buzz: opz(z.string()),
      sessioni: opzD(z.array(sessionePrescrittaInputSchema), []),
    },
    handler: async ({
      tipo,
      contenuto,
      motivazione,
      durata_settimane,
      riferimento_thread_buzz,
      sessioni,
    }: {
      tipo: 'allenamento' | 'nutrizione'
      contenuto: Record<string, unknown>
      motivazione: string
      durata_settimane?: number
      riferimento_thread_buzz?: string
      sessioni: z.infer<typeof sessionePrescrittaInputSchema>[]
    }) => {
      const [{ data: pianoAttivo }, { data: ultimoPiano }] = await Promise.all([
        supabase.from('piano').select('id').eq('tipo', tipo).eq('stato', 'attivo').maybeSingle(),
        supabase.from('piano').select('versione').eq('tipo', tipo).order('versione', { ascending: false }).limit(1).maybeSingle(),
      ])

      const nuovaVersione = (ultimoPiano?.versione ?? 0) + 1

      const { data: piano, error } = await supabase
        .from('piano')
        .insert({
          tipo,
          stato: 'proposta',
          versione: nuovaVersione,
          autore_agente: env.agentName,
          motivazione,
          durata_settimane: durata_settimane ?? null,
          riferimento_thread_buzz: riferimento_thread_buzz ?? null,
          contenuto,
          piano_precedente_id: pianoAttivo?.id ?? null,
        })
        .select('*')
        .single()
      if (error) throw new Error(error.message)

      if (sessioni.length > 0) {
        const { error: errSessioni } = await supabase.from('sessione_prescritta').insert(
          sessioni.map((s) => ({
            piano_id: piano.id,
            giorno_numero: s.giorno_numero,
            tipo: s.tipo,
            esercizi: s.esercizi,
            durata_minuti_suggerita: s.durata_minuti_suggerita ?? null,
            distanza_km_suggerita: s.distanza_km_suggerita ?? null,
            zona_frequenza_cardiaca: s.zona_frequenza_cardiaca ?? null,
            note: s.note ?? null,
          })),
        )
        if (errSessioni) throw new Error(errSessioni.message)
      }

      return { piano, sessioni_create: sessioni.length }
    },
  },
  {
    name: 'proponi_sessioni',
    description:
      'Aggiunge sessioni prescritte a un piano che è ANCORA in stato proposta (non a un piano già attivo — per cambiare un piano attivo serve una nuova proposta con proponi_piano).',
    inputSchema: {
      piano_id: z.string().uuid(),
      sessioni: z.array(sessionePrescrittaInputSchema).min(1),
    },
    handler: async ({
      piano_id,
      sessioni,
    }: {
      piano_id: string
      sessioni: z.infer<typeof sessionePrescrittaInputSchema>[]
    }) => {
      const { data: piano, error: errPiano } = await supabase.from('piano').select('stato').eq('id', piano_id).single()
      if (errPiano) throw new Error(errPiano.message)
      if (piano.stato !== 'proposta') {
        throw new Error(
          `Il piano è in stato "${piano.stato}", non "proposta": non puoi aggiungere sessioni a un piano già attivo o archiviato. Crea una nuova proposta con proponi_piano.`,
        )
      }

      const { data, error } = await supabase
        .from('sessione_prescritta')
        .insert(
          sessioni.map((s) => ({
            piano_id,
            giorno_numero: s.giorno_numero,
            tipo: s.tipo,
            esercizi: s.esercizi,
            durata_minuti_suggerita: s.durata_minuti_suggerita ?? null,
            distanza_km_suggerita: s.distanza_km_suggerita ?? null,
            zona_frequenza_cardiaca: s.zona_frequenza_cardiaca ?? null,
            note: s.note ?? null,
          })),
        )
        .select('*')
      if (error) throw new Error(error.message)
      return data
    },
  },
  {
    name: 'modifica_proposta',
    description:
      "Modifica una proposta di piano ESISTENTE ancora in stato 'proposta' (non attiva): aggiorna contenuto/motivazione/durata " +
      "e/o sostituisce le sessioni prescritte, invece di dover buttare via e ricreare da zero con proponi_piano ogni volta " +
      "che cambia un dettaglio prima che l'utente approvi. Se passi `sessioni`, SOSTITUISCE integralmente le sessioni " +
      "esistenti del piano (non le aggiunge: per aggiungerne senza toccare le altre usa proponi_sessioni). " +
      "Fallisce se il piano è già attivo o archiviato: in quel caso serve una nuova proposta con proponi_piano.",
    inputSchema: {
      piano_id: z.string().uuid(),
      contenuto: opz(z.record(z.any())),
      motivazione: opz(z.string()),
      durata_settimane: opz(z.number().int().positive()),
      sessioni: opz(z.array(sessionePrescrittaInputSchema)),
    },
    handler: async ({
      piano_id,
      contenuto,
      motivazione,
      durata_settimane,
      sessioni,
    }: {
      piano_id: string
      contenuto?: Record<string, unknown>
      motivazione?: string
      durata_settimane?: number
      sessioni?: z.infer<typeof sessionePrescrittaInputSchema>[]
    }) => {
      const { data: piano, error: errPiano } = await supabase.from('piano').select('stato').eq('id', piano_id).single()
      if (errPiano) throw new Error(errPiano.message)
      if (piano.stato !== 'proposta') {
        throw new Error(
          `Il piano è in stato "${piano.stato}", non "proposta": non puoi modificarlo. Crea una nuova proposta con proponi_piano.`,
        )
      }

      const aggiornamenti: Record<string, unknown> = {}
      if (contenuto !== undefined) aggiornamenti.contenuto = contenuto
      if (motivazione !== undefined) aggiornamenti.motivazione = motivazione
      if (durata_settimane !== undefined) aggiornamenti.durata_settimane = durata_settimane

      let pianoAggiornato = null
      if (Object.keys(aggiornamenti).length > 0) {
        const { data, error } = await supabase.from('piano').update(aggiornamenti).eq('id', piano_id).select('*').single()
        if (error) throw new Error(error.message)
        pianoAggiornato = data
      }

      let sessioniAggiornate: unknown[] | null = null
      if (sessioni !== undefined) {
        const { error: errDelete } = await supabase.from('sessione_prescritta').delete().eq('piano_id', piano_id)
        if (errDelete) throw new Error(errDelete.message)

        if (sessioni.length > 0) {
          const { data, error: errInsert } = await supabase
            .from('sessione_prescritta')
            .insert(
          sessioni.map((s) => ({
            piano_id,
            giorno_numero: s.giorno_numero,
            tipo: s.tipo,
            esercizi: s.esercizi,
            durata_minuti_suggerita: s.durata_minuti_suggerita ?? null,
            distanza_km_suggerita: s.distanza_km_suggerita ?? null,
            zona_frequenza_cardiaca: s.zona_frequenza_cardiaca ?? null,
            note: s.note ?? null,
          })),
        )
            .select('*')
          if (errInsert) throw new Error(errInsert.message)
          sessioniAggiornate = data
        } else {
          sessioniAggiornate = []
        }
      }

      return { piano: pianoAggiornato, sessioni: sessioniAggiornate }
    },
  },
  {
    name: 'annota_log',
    description: "Aggiunge un'annotazione a una sessione loggata dall'utente (non modifica il log, lo commenta).",
    inputSchema: {
      sessione_eseguita_id: z.string().uuid(),
      contenuto: z.string(),
    },
    handler: async ({ sessione_eseguita_id, contenuto }: { sessione_eseguita_id: string; contenuto: string }) => {
      const { data, error } = await supabase
        .from('nota_agente')
        .insert({
          autore_agente: env.agentName,
          destinatario_tipo: 'sessione_eseguita',
          destinatario_id: sessione_eseguita_id,
          contenuto,
        })
        .select('*')
        .single()
      if (error) throw new Error(error.message)
      return data
    },
  },
  {
    name: 'leggi_memoria_persona',
    description:
      'Legge le note di sfondo salvate su una persona specifica: vincoli fisici, preferenze, contesto di vita, ' +
      "stile di comunicazione. Non duplica obiettivi/misure/log (quelli hanno tool dedicate) — è conoscenza " +
      'relazionale libera su chi ti sta parlando. Più recenti prima.',
    inputSchema: {
      pubkey_persona: z.string().describe('Pubkey Nostr della persona'),
      categoria: opz(memoriaCategoriaSchema),
      limite: opzD(z.number().int().positive().max(50), 20),
    },
    handler: async ({
      pubkey_persona,
      categoria,
      limite,
    }: {
      pubkey_persona: string
      categoria?: z.infer<typeof memoriaCategoriaSchema>
      limite: number
    }) => {
      let query = supabase
        .from('memoria_persona')
        .select('*')
        .eq('pubkey_persona', pubkey_persona)
        .order('created_at', { ascending: false })
        .limit(limite)
      if (categoria) query = query.eq('categoria', categoria)
      const { data, error } = await query
      if (error) throw new Error(error.message)
      return data
    },
  },
  {
    name: 'salva_memoria_persona',
    description:
      "Salva una nota di sfondo su una persona specifica — un vincolo fisico, una preferenza, un elemento di " +
      "contesto di vita, o un'indicazione sullo stile di comunicazione che preferisce. Non usarlo per obiettivi " +
      '(vedi proponi_piano) o per un commento su un log specifico (vedi annota_log): solo per conoscenza sulla ' +
      "persona in sé, che vale a prescindere dalla singola conversazione o sessione.",
    inputSchema: {
      pubkey_persona: z.string().describe('Pubkey Nostr della persona'),
      contenuto: z.string(),
      categoria: memoriaCategoriaSchema,
    },
    handler: async ({
      pubkey_persona,
      contenuto,
      categoria,
    }: {
      pubkey_persona: string
      contenuto: string
      categoria: z.infer<typeof memoriaCategoriaSchema>
    }) => {
      const { data, error } = await supabase
        .from('memoria_persona')
        .insert({ pubkey_persona, autore_agente: env.agentName, contenuto, categoria })
        .select('*')
        .single()
      if (error) throw new Error(error.message)
      return data
    },
  },
  {
    name: 'registra_intervento',
    description:
      'Registra un intervento proattivo (anomalia o domanda di chiarimento) prima di scriverlo in chat. ' +
      'Rispetta il tetto di 3 interventi non richiesti a settimana (il check settimanale del lunedì non conta nel tetto): ' +
      'se il tetto è superato, il tool rifiuta e va rimandato al check di lunedì.',
    inputSchema: {
      tipo: z.enum(['check_settimanale', 'anomalia', 'chiarimento']),
      contenuto: z.string(),
      riferimento_thread_buzz: opz(z.string()),
    },
    handler: async ({
      tipo,
      contenuto,
      riferimento_thread_buzz,
    }: {
      tipo: 'check_settimanale' | 'anomalia' | 'chiarimento'
      contenuto: string
      riferimento_thread_buzz?: string
    }) => {
      if (tipo !== 'check_settimanale') {
        const seteGiorniFa = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        const { count, error: errCount } = await supabase
          .from('intervento_agente')
          .select('id', { count: 'exact', head: true })
          .neq('tipo', 'check_settimanale')
          .gte('data', seteGiorniFa)
        if (errCount) throw new Error(errCount.message)
        if ((count ?? 0) >= 3) {
          throw new Error(
            'Tetto di 3 interventi proattivi settimanali già raggiunto. Rimanda questo intervento al check settimanale del lunedì.',
          )
        }
      }

      const { data, error } = await supabase
        .from('intervento_agente')
        .insert({
          tipo,
          autore_agente: env.agentName,
          contenuto,
          riferimento_thread_buzz: riferimento_thread_buzz ?? null,
        })
        .select('*')
        .single()
      if (error) throw new Error(error.message)
      return data
    },
  },
] as const
