const IDENTITY_KEY = 'uneau.identity.v1'
const NAME_KEY = 'uneau.playerName'

export interface LocalIdentity {
  playerId: string
  reconnectToken: string
}

export function getLocalIdentity(): LocalIdentity {
  const stored = localStorage.getItem(IDENTITY_KEY)
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as Partial<LocalIdentity>
      if (parsed.playerId && parsed.reconnectToken?.length === 64) return parsed as LocalIdentity
    } catch { /* recreate an invalid identity */ }
  }
  const identity = { playerId: crypto.randomUUID(), reconnectToken: randomHex(32) }
  localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity))
  return identity
}

export function getSavedName(): string {
  return localStorage.getItem(NAME_KEY) ?? ''
}

export function saveName(name: string): void {
  localStorage.setItem(NAME_KEY, name.trim())
}

export function generateRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('')
}

export function roomPeerId(code: string): string {
  return `uneau-room-${code.toLowerCase()}`
}

export async function reconnectProof(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function randomHex(size: number): string {
  return [...crypto.getRandomValues(new Uint8Array(size))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
