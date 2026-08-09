import { readFileSync } from 'node:fs'

export function loadPersona(path: string): string {
  return readFileSync(path, 'utf8')
}
