function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Variabile d'ambiente mancante: ${name}`)
  }
  return value
}

export const env = {
  relayUrl: process.env.BUZZ_RELAY_URL ?? 'ws://localhost:3000',
  botPrivateKeyHex: required('BUZZ_BOT_PRIVATE_KEY'),
  channelId: required('BUZZ_CHANNEL_ID'),
  agentName: required('AGENT_NAME'),
  agentDisplayName: process.env.AGENT_DISPLAY_NAME ?? required('AGENT_NAME'),
  personaPath: required('PERSONA_PATH'),
  openaiApiKey: required('OPENAI_API_KEY'),
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-5.6-luna',
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  // Pubkey di eventuali altri agenti bot nello stesso canale (non segreta, è pubblica).
  // Usata per non rispondere spontaneamente ai loro messaggi (solo su menzione esplicita),
  // altrimenti due agenti che si sentono entrambi "in causa" potrebbero rispondersi all'infinito.
  peerAgentPubkeys: (process.env.PEER_AGENT_PUBKEYS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
}
