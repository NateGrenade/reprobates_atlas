export type Provider = 'claude' | 'codex' | 'fake'
export interface ModelOption { value: string; label: string; efforts: string[] }
export interface Selection { model: string; effort: string }
export interface Step {
  kind: 'text' | 'tool'
  text: string
}
export interface Message {
  role: 'user' | 'assistant'
  steps: Step[]
  error?: string
}
export interface Session {
  id: string
  provider: Provider
  title: string
  vault: string
  /** the provider's own session id, used to resume here or in the full app */
  remoteId?: string
  messages: Message[]
  running: boolean
  updated: number
}
export interface ProviderStatus {
  installed: boolean
  signedIn: boolean
  detail: string
}
