const PASTE_BATCH_CHUNK_SIZE = 4096
const PASTE_BATCH_CHUNKS_PER_TICK = 8

type PendingQueue = {
  chunks: string[]
  flushTimer: ReturnType<typeof setTimeout> | null
}

const pendingQueues = new Map<string, PendingQueue>()

const getQueue = (tabId: string): PendingQueue => {
  const existing = pendingQueues.get(tabId)
  if (existing) {
    return existing
  }

  const created: PendingQueue = {
    chunks: [],
    flushTimer: null,
  }
  pendingQueues.set(tabId, created)
  return created
}

const writeDirect = (tabId: string, data: string): void => {
  window.termbridge.write(tabId, data)
}

const scheduleFlush = (tabId: string): void => {
  const queue = getQueue(tabId)
  if (queue.flushTimer !== null) {
    return
  }

  queue.flushTimer = setTimeout(() => {
    queue.flushTimer = null

    let sentChunks = 0
    while (queue.chunks.length > 0 && sentChunks < PASTE_BATCH_CHUNKS_PER_TICK) {
      const chunk = queue.chunks.shift()
      if (!chunk) {
        continue
      }

      writeDirect(tabId, chunk)
      sentChunks += 1
    }

    if (queue.chunks.length > 0) {
      scheduleFlush(tabId)
    }
  }, 0)
}

const enqueueChunkedWrite = (tabId: string, data: string): void => {
  const queue = getQueue(tabId)
  for (let index = 0; index < data.length; index += PASTE_BATCH_CHUNK_SIZE) {
    queue.chunks.push(data.slice(index, index + PASTE_BATCH_CHUNK_SIZE))
  }

  scheduleFlush(tabId)
}

const write = (tabId: string, data: string): void => {
  const queue = getQueue(tabId)
  if (queue.chunks.length > 0 || queue.flushTimer !== null) {
    queue.chunks.push(data)
    scheduleFlush(tabId)
    return
  }

  writeDirect(tabId, data)
}

const writeImmediate = (tabId: string, data: string): void => {
  writeDirect(tabId, data)
}

const writePaste = (tabId: string, data: string): void => {
  const queue = getQueue(tabId)
  if (data.length <= PASTE_BATCH_CHUNK_SIZE && queue.chunks.length === 0 && queue.flushTimer === null) {
    writeDirect(tabId, data)
    return
  }

  enqueueChunkedWrite(tabId, data)
}

export const ptyClient = {
  spawn: (tabId: string, cols: number, rows: number): Promise<boolean> => window.termbridge.spawn(tabId, cols, rows),
  connectLocal: (
    tabId: string,
    host: string,
    port: number,
    protocol: 'telnet' | 'raw',
  ): Promise<boolean> => window.termbridge.connectLocal(tabId, host, port, protocol),
  write,
  writeImmediate,
  writePaste,
  resize: (tabId: string, cols: number, rows: number): Promise<boolean> => window.termbridge.resize(tabId, cols, rows),
  kill: (tabId: string): Promise<boolean> => window.termbridge.kill(tabId),
  onData: (listener: (payload: { tabId: string; data: string }) => void): (() => void) => window.termbridge.onPtyData(listener),
  onExit: (listener: (payload: { tabId: string; exitCode: number }) => void): (() => void) =>
    window.termbridge.onPtyExit(listener),
}
