import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type PosApi } from '../shared/pos-api'

const posApi: PosApi = {
  app: {
    getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.appGetVersion)
  },
  products: {
    list: (options) => ipcRenderer.invoke(IPC_CHANNELS.productsList, options),
    getBySku: (sku) => ipcRenderer.invoke(IPC_CHANNELS.productsGetBySku, sku),
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.productsCreate, input),
    update: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.productsUpdate, id, input),
    setActive: (id, isActive) => ipcRenderer.invoke(IPC_CHANNELS.productsSetActive, id, isActive)
  }
}

contextBridge.exposeInMainWorld('pos', posApi)
