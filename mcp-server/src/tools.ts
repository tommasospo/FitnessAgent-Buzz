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

const esercizioSchema = z
  .object({
    nome: z.string(),
    serie: z.number().int().positive(),
    ripetizioni: z.number().int().positive().optional(),
    secondi: z.number().int().positive().optional(),
    carico: z.number().optional(),
    recupero_secondi: z.number().int().optional(),
    note: z.string().optional(),
  })
  .refine((e) => (e.ripetizioni !== undefined) !== (e.secondi !== undefined), {
    message: 'Specifica esattamente uno tra ripetizioni e secondi (a seconda che l\'esercizio sia a ripetizioni o a tempo).',
  })

const sessionePrescrittaInputSchema = z.object({
  data_prevista: z.string().describe('Data ISO (YYYY-MM-DD)'),
  tipo: z.enum(['palestra', 'corsa', 'nuoto', 'altro']),
  esercizi: z.array(esercizioSchema).default([]),
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
          .order('data_prevista', { ascending: true })
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
      limite: z.number().int().positive().max(50).default(10),
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
      da: z.string().optional().describe('Data ISO minima (inclusa)'),
      a: z.string().optional().describe('Data ISO massima (inclusa)'),
      limite: z.number().int().positive().max(100).default(20),
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
      tipo: z.enum(['peso', 'circonferenza', 'massa_grassa', 'altro']).optional(),
      da: z.string().optional(),
      a: z.string().optional(),
      limite: z.number().int().positive().max(200).default(50),
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
      marker: z.string().optional().describe('Nome esatto del marker, es. "ferritina"'),
      da: z.string().optional(),
      a: z.string().optional(),
      limite: z.number().int().positive().max(200).default(50),
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
    name: 'leggi_note_agente',
    description: 'Legge le annotazioni lasciate dagli agenti sul log o su altri record, più recenti prima.',
    inputSchema: {
      destinatario_tipo: z.string().optional(),
      destinatario_id: z.string().uuid().optional(),
      limite: z.number().int().positive().max(200).default(50),
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
      riferimento_thread_buzz: z.string().optional(),
      sessioni: z.array(sessionePrescrittaInputSchema).default([]),
    },
    handler: async ({
      tipo,
      contenuto,
      motivazione,
      riferimento_thread_buzz,
      sessioni,
    }: {
      tipo: 'allenamento' | 'nutrizione'
      contenuto: Record<string, unknown>
      motivazione: string
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
            data_prevista: s.data_prevista,
            tipo: s.tipo,
            esercizi: s.esercizi,
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
        .insert(sessioni.map((s) => ({ piano_id, data_prevista: s.data_prevista, tipo: s.tipo, esercizi: s.esercizi })))
        .select('*')
      if (error) throw new Error(error.message)
      return data
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
    name: 'registra_intervento',
    description:
      'Registra un intervento proattivo (anomalia o domanda di chiarimento) prima di scriverlo in chat. ' +
      'Rispetta il tetto di 3 interventi non richiesti a settimana (il check settimanale del lunedì non conta nel tetto): ' +
      'se il tetto è superato, il tool rifiuta e va rimandato al check di lunedì.',
    inputSchema: {
      tipo: z.enum(['check_settimanale', 'anomalia', 'chiarimento']),
      contenuto: z.string(),
      riferimento_thread_buzz: z.string().optional(),
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
