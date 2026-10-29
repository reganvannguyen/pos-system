import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type PosApi } from '../shared/pos-api'

const posApi: PosApi = {
  app: {
    getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.appGetVersion)
  },
  customers: {
    list: (query) => ipcRenderer.invoke(IPC_CHANNELS.customersList, query),
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.customersCreate, input),
    update: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.customersUpdate, id, input)
  },
  products: {
    list: (options) => ipcRenderer.invoke(IPC_CHANNELS.productsList, options),
    getBySku: (sku) => ipcRenderer.invoke(IPC_CHANNELS.productsGetBySku, sku),
    getBySkuForReturn: (sku) => ipcRenderer.invoke(IPC_CHANNELS.productsGetBySkuForReturn, sku),
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.productsCreate, input),
    update: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.productsUpdate, id, input),
    setActive: (id, isActive) => ipcRenderer.invoke(IPC_CHANNELS.productsSetActive, id, isActive)
  },
  sales: {
    quote: (items) => ipcRenderer.invoke(IPC_CHANNELS.salesQuote, items),
    completeCheckout: (request) => ipcRenderer.invoke(IPC_CHANNELS.salesCompleteCheckout, request),
    quoteReturn: (request) => ipcRenderer.invoke(IPC_CHANNELS.salesQuoteReturn, request),
    completeReturn: (request) => ipcRenderer.invoke(IPC_CHANNELS.salesCompleteReturn, request),
    recordChargePayment: (request) =>
      ipcRenderer.invoke(IPC_CHANNELS.salesRecordChargePayment, request),
    listRecent: () => ipcRenderer.invoke(IPC_CHANNELS.salesListRecent),
    report: (period) => ipcRenderer.invoke(IPC_CHANNELS.salesReport, period),
    productsForDay: (date) => ipcRenderer.invoke(IPC_CHANNELS.salesProductsForDay, date),
    exportCsv: (period) => ipcRenderer.invoke(IPC_CHANNELS.salesExportCsv, period),
    exportPdf: (period, summaryGroups, reportType) =>
      ipcRenderer.invoke(IPC_CHANNELS.salesExportPdf, period, summaryGroups, reportType),
    getById: (id) => ipcRenderer.invoke(IPC_CHANNELS.salesGetById, id)
  },
  printers: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.printersList)
  },
  settings: {
    getReceipt: () => ipcRenderer.invoke(IPC_CHANNELS.settingsGetReceipt),
    saveReceipt: (settings) => ipcRenderer.invoke(IPC_CHANNELS.settingsSaveReceipt, settings),
    getBusiness: () => ipcRenderer.invoke(IPC_CHANNELS.settingsGetBusiness),
    saveBusiness: (settings) => ipcRenderer.invoke(IPC_CHANNELS.settingsSaveBusiness, settings),
    getTaxes: () => ipcRenderer.invoke(IPC_CHANNELS.settingsGetTaxes),
    saveTaxes: (settings) => ipcRenderer.invoke(IPC_CHANNELS.settingsSaveTaxes, settings)
  },
  backups: {
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.backupsGetStatus),
    chooseDestination: () => ipcRenderer.invoke(IPC_CHANNELS.backupsChooseDestination),
    runManual: () => ipcRenderer.invoke(IPC_CHANNELS.backupsRunManual),
    restore: () => ipcRenderer.invoke(IPC_CHANNELS.backupsRestore)
  },
  receipts: {
    printTest: () => ipcRenderer.invoke(IPC_CHANNELS.receiptsPrintTest),
    print: (saleId) => ipcRenderer.invoke(IPC_CHANNELS.receiptsPrint, saleId),
    emailDraft: (saleId, recipient) =>
      ipcRenderer.invoke(IPC_CHANNELS.receiptsEmailDraft, saleId, recipient),
    textDraft: (saleId, recipient) =>
      ipcRenderer.invoke(IPC_CHANNELS.receiptsTextDraft, saleId, recipient),
    openPdf: (saleId) => ipcRenderer.invoke(IPC_CHANNELS.receiptsOpenPdf, saleId),
    viewPdf: (saleId) => ipcRenderer.invoke(IPC_CHANNELS.receiptsViewPdf, saleId)
  }
}

contextBridge.exposeInMainWorld('pos', posApi)
