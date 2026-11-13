export interface EditableWorld {
  shortId: string
  title: string
  description?: string
  advancedDescription?: string | null
  discordThreadUrl?: string | null
  image?: string | null
  isLocked?: boolean
  isMod?: boolean
  isUnremixable?: boolean
  tags?: string[]
  visibility?: 'private' | 'unlisted'
  initialGameState: Record<string, unknown>
  [key: string]: unknown
}

export interface ReadWorldResult {
  world: EditableWorld
  etag: string | null
}
