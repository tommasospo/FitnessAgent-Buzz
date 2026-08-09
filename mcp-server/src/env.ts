function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Variabile d'ambiente mancante: ${name}`)
  }
  return value
}

export const env = {
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  agentName: required('AGENT_NAME'),
}
