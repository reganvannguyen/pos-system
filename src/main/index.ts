import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { IPC_CHANNELS } from '../shared/pos-api'
import { openDatabase } from './database/connection'
import { createRepositories } from './database/repositories'
import type { PosDatabase } from './database/types'
import { createProductService, toProductResult } from './product-service'
import { createSalesService, toSalesResult } from './sales-service'

let database: PosDatabase | undefined
let repositories: ReturnType<typeof createRepositories> | undefined
let productService: ReturnType<typeof createProductService> | undefined
let salesService: ReturnType<typeof createSalesService> | undefined

function createWindow(): void {
  const mainWindow = new BrowserWindow({
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

function requireProductService(): NonNullable<typeof productService> {
  if (!productService) throw new Error('The product service is not ready.')
  return productService
}

function requireSalesService(): NonNullable<typeof salesService> {
  if (!salesService) throw new Error('The sales service is not ready.')
  return salesService
}

app.whenReady().then(() => {
  try {
    database = openDatabase(join(app.getPath('userData'), 'pos-system.sqlite'))
    repositories = createRepositories(database)
    repositories.settings.get()
    productService = createProductService(repositories.products)
    salesService = createSalesService(repositories.sales)
  } catch (error) {
    repositories = undefined
    productService = undefined
    salesService = undefined
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
