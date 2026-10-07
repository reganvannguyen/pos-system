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
  },
  sales: {
    quote: (items) => ipcRenderer.invoke(IPC_CHANNELS.salesQuote, items),
    completeCheckout: (request) => ipcRenderer.invoke(IPC_CHANNELS.salesCompleteCheckout, request),
    listRecent: () => ipcRenderer.invoke(IPC_CHANNELS.salesListRecent),
    getById: (id) => ipcRenderer.invoke(IPC_CHANNELS.salesGetById, id)
  },
  printers: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.printersList)
  },
  settings: {
    getReceipt: () => ipcRenderer.invoke(IPC_CHANNELS.settingsGetReceipt),
    saveReceipt: (settings) => ipcRenderer.invoke(IPC_CHANNELS.settingsSaveReceipt, settings),
    getBusiness: () => ipcRenderer.invoke(IPC_CHANNELS.settingsGetBusiness),
    saveBusiness: (settings) => ipcRenderer.invoke(IPC_CHANNELS.settingsSaveBusiness, settings)
  },
  receipts: {
    print: (saleId) => ipcRenderer.invoke(IPC_CHANNELS.receiptsPrint, saleId)
  }
}

contextBridge.exposeInMainWorld('pos', posApi)
