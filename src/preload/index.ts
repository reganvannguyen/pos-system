import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type PosApi } from '../shared/pos-api'

const posApi: PosApi = {
  app: {
    getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.appGetVersion)
  }
}

contextBridge.exposeInMainWorld('pos', posApi)
