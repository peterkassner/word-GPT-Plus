import Dexie from 'dexie'

/** Same key as `generalTools` session queue — kept here to avoid circular imports. */
const QUEUE_ROW_ID = 'default'

export interface TelemetryQueueRow {
  id: string
  eventsJson: string
  updatedAt: number
}

export interface TelemetryQueueEvent {
  type: string
  ts: string
  queuedAt?: string
  [key: string]: unknown
}

class TelemetryQueueDB extends Dexie {
  queue!: Dexie.Table<TelemetryQueueRow, string>

  constructor() {
    super('WordGptPlusTelemetryQueue')
    this.version(1).stores({ queue: 'id' })
  }
}

let dbInstance: TelemetryQueueDB | null = null

function getDb(): TelemetryQueueDB {
  if (!dbInstance) {
    dbInstance = new TelemetryQueueDB()
  }
  return dbInstance
}

function safeParse(raw: string | null): TelemetryQueueEvent[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function readTelemetryQueueFromIndexedDb(): Promise<TelemetryQueueEvent[]> {
  if (typeof indexedDB === 'undefined') return []
  try {
    const row = await getDb().queue.get(QUEUE_ROW_ID)
    if (!row?.eventsJson) return []
    return safeParse(row.eventsJson)
  } catch {
    return []
  }
}

export async function writeTelemetryQueueToIndexedDb(events: TelemetryQueueEvent[]): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  try {
    await getDb().queue.put({
      id: QUEUE_ROW_ID,
      eventsJson: JSON.stringify(events),
      updatedAt: Date.now(),
    })
  } catch {
    /* ignore quota / private mode */
  }
}

export async function clearTelemetryQueueIndexedDb(): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  try {
    await getDb().queue.delete(QUEUE_ROW_ID)
  } catch {
    /* ignore */
  }
}
