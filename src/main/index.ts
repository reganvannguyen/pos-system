import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { IPC_CHANNELS } from '../shared/pos-api'
import { openDatabase } from './database/connection'
import { createRepositories } from './database/repositories'
import type { PosDatabase } from './database/types'
import { createProductService, toProductResult } from './product-service'
import { printReceiptHtml } from './electron-printer'
import { createReceiptService, toReceiptResult } from './receipt-service'
import { createSalesService, toSalesResult } from './sales-service'

let database: PosDatabase | undefined
let repositories: ReturnType<typeof createRepositories> | undefined
let productService: ReturnType<typeof createProductService> | undefined
let salesService: ReturnType<typeof createSalesService> | undefined
let receiptService: ReturnType<typeof createReceiptService> | undefined
let mainWindow: BrowserWindow | undefined

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 620,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = undefined
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerProductHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.productsList, (_event, options: unknown) =>
    toProductResult(() => requireProductService().list(options))
  )
  ipcMain.handle(IPC_CHANNELS.productsGetBySku, (_event, sku: unknown) =>
    toProductResult(() => requireProductService().getBySku(sku))
  )
  ipcMain.handle(IPC_CHANNELS.productsCreate, (_event, input: unknown) =>
    toProductResult(() => requireProductService().create(input))
  )
  ipcMain.handle(IPC_CHANNELS.productsUpdate, (_event, id: unknown, input: unknown) =>
    toProductResult(() => requireProductService().update(id, input))
  )
  ipcMain.handle(IPC_CHANNELS.productsSetActive, (_event, id: unknown, isActive: unknown) =>
    toProductResult(() => requireProductService().setActive(id, isActive))
  )
}

function registerSalesHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.salesQuote, (_event, items: unknown) =>
    toSalesResult(() => requireSalesService().quote(items))
  )
  ipcMain.handle(IPC_CHANNELS.salesCompleteCheckout, (_event, request: unknown) =>
    toSalesResult(() => requireSalesService().completeCheckout(request))
  )
  ipcMain.handle(IPC_CHANNELS.salesListRecent, () =>
    toSalesResult(() => requireSalesService().listRecent())
  )
  ipcMain.handle(IPC_CHANNELS.salesGetById, (_event, id: unknown) =>
    toSalesResult(() => requireSalesService().getById(id))
  )
}

function registerReceiptHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.printersList, () =>
    toReceiptResult(() => requireReceiptService().listPrinters())
  )
  ipcMain.handle(IPC_CHANNELS.settingsGetReceipt, () =>
    toReceiptResult(() => requireReceiptService().getSettings())
  )
  ipcMain.handle(IPC_CHANNELS.settingsSaveReceipt, (_event, settings: unknown) =>
    toReceiptResult(() => requireReceiptService().saveSettings(settings))
  )
  ipcMain.handle(IPC_CHANNELS.receiptsPrint, (_event, saleId: unknown) =>
    toReceiptResult(() => requireReceiptService().print(saleId))
  )
}

function requireProductService(): NonNullable<typeof productService> {
  if (!productService) throw new Error('The product service is not ready.')
  return productService
}

function requireSalesService(): NonNullable<typeof salesService> {
  if (!salesService) throw new Error('The sales service is not ready.')
  return salesService
}

function requireReceiptService(): NonNullable<typeof receiptService> {
  if (!receiptService) throw new Error('The receipt service is not ready.')
  return receiptService
}

app.whenReady().then(() => {
  try {
    database = openDatabase(join(app.getPath('userData'), 'pos-system.sqlite'))
    repositories = createRepositories(database)
    repositories.settings.get()
    productService = createProductService(repositories.products)
    salesService = createSalesService(repositories.sales, repositories.settings)
    receiptService = createReceiptService({
      sales: repositories.sales,
      settings: repositories.settings,
      listSystemPrinters: async () => (await mainWindow?.webContents.getPrintersAsync()) ?? [],
      printHtml: printReceiptHtml
    })
  } catch (error) {
    repositories = undefined
    productService = undefined
    salesService = undefined
    receiptService = undefined
    database?.close()
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox('Unable to open the local database', message)
    app.quit()
    return
  }

  app.setAppUserModelId('com.regannguyen.possystem')

  ipcMain.handle(IPC_CHANNELS.appGetVersion, () => app.getVersion())
  registerProductHandlers()
  registerSalesHandlers()
  registerReceiptHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (database?.open) database.close()
})
