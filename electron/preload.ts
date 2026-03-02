import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

const onPtyData = (listener: (payload: { tabId: string; data: string }) => void): (() => void) => {
  const wrapped = (_event: IpcRendererEvent, payload: { tabId: string; data: string }) => listener(payload)
  ipcRenderer.on('pty:data', wrapped)

  return () => {
    ipcRenderer.removeListener('pty:data', wrapped)
  }
}

const onPtyExit = (listener: (payload: { tabId: string; exitCode: number }) => void): (() => void) => {
  const wrapped = (_event: IpcRendererEvent, payload: { tabId: string; exitCode: number }) => listener(payload)
  ipcRenderer.on('pty:exit', wrapped)

  return () => {
    ipcRenderer.removeListener('pty:exit', wrapped)
  }
}

contextBridge.exposeInMainWorld('termbridge', {
  spawn: (tabId: string, cols: number, rows: number) => ipcRenderer.invoke('pty:spawn', tabId, cols, rows),
  connectLocal: (tabId: string, host: string, port: number, protocol: 'telnet' | 'raw') =>
    ipcRenderer.invoke('session:connectLocal', tabId, host, port, protocol),
  write: (tabId: string, data: string) => ipcRenderer.send('pty:write', { tabId, data }),
  resize: (tabId: string, cols: number, rows: number) => ipcRenderer.invoke('pty:resize', tabId, cols, rows),
  kill: (tabId: string) => ipcRenderer.invoke('pty:kill', tabId),
  loadGlossary: () => ipcRenderer.invoke('glossary:load'),
  reloadGlossary: () => ipcRenderer.invoke('glossary:reload'),
  importGlossary: () => ipcRenderer.invoke('glossary:import'),
  exportGlossary: () => ipcRenderer.invoke('glossary:export'),
  upsertGlossaryEntry: (entry: unknown) => ipcRenderer.invoke('glossary:upsert', entry),
  deleteGlossaryEntry: (payload: unknown) => ipcRenderer.invoke('glossary:delete', payload),
  loadTranslationConfig: () => ipcRenderer.invoke('translate:loadConfig'),
  saveTranslationConfig: (nextConfig: unknown) => ipcRenderer.invoke('translate:saveConfig', nextConfig),
  translateOnline: (request: unknown) => ipcRenderer.invoke('translate:online', request),
  loadContexts: () => ipcRenderer.invoke('contexts:load'),
  reloadContexts: () => ipcRenderer.invoke('contexts:reload'),
  saveContexts: (nextConfig: unknown) => ipcRenderer.invoke('contexts:save', nextConfig),
  exportSessionLog: (payload: unknown) => ipcRenderer.invoke('logs:exportSession', payload),
  onPtyData,
  onPtyExit,
})
