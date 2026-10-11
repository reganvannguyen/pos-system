import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { IPC_CHANNELS } from '../shared/pos-api'
import { openDatabase } from './database/connection'
import { createRepositories } from './database/repositories'
import type { PosDatabase } from './database/types'
import { createProductService, toProductResult } from './product-service'
import {
  createBusinessSettingsService,
  toBusinessSettingsResult
} from './business-settings-service'
import { createTaxSettingsService, toTaxSettingsResult } from './tax-settings-service'
import { printReceiptHtml } from './electron-printer'
import { createReceiptPdf } from './electron-receipt-pdf'
import { createSalesReportPdf } from './electron-sales-report-pdf'
import { openWindowsEmailDraft } from './windows-mail'
import { createReceiptService, toReceiptResult } from './receipt-service'
import { createSalesExportService } from './sales-export-service'
import { createSalesService, toSalesResult, toSalesResultAsync } from './sales-service'

let database: PosDatabase | undefined
let repositories: ReturnType<typeof createRepositories> | undefined
let productService: ReturnType<typeof createProductService> | undefined
let businessSettingsService: ReturnType<typeof createBusinessSettingsService> | undefined
let taxSettingsService: ReturnType<typeof createTaxSettingsService> | undefined
let salesService: ReturnType<typeof createSalesService> | undefined
let salesExportService: ReturnType<typeof createSalesExportService> | undefined
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
  ipcMain.handle(IPC_CHANNELS.productsGetBySkuForReturn, (_event, sku: unknown) =>
    toProductResult(() => requireProductService().getBySkuForReturn(sku))
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
  ipcMain.handle(IPC_CHANNELS.salesQuoteReturn, (_event, request: unknown) =>
    toSalesResult(() => requireSalesService().quoteReturn(request))
  )
  ipcMain.handle(IPC_CHANNELS.salesCompleteReturn, (_event, request: unknown) =>
    toSalesResult(() => requireSalesService().completeReturn(request))
  )
  ipcMain.handle(IPC_CHANNELS.salesRecordChargePayment, (_event, request: unknown) =>
    toSalesResult(() => requireSalesService().recordChargePayment(request))
  )
  ipcMain.handle(IPC_CHANNELS.salesListRecent, () =>
    toSalesResult(() => requireSalesService().listRecent())
  )
  ipcMain.handle(IPC_CHANNELS.salesReport, (_event, period: unknown) =>
    toSalesResult(() => requireSalesService().report(period))
  )
  ipcMain.handle(IPC_CHANNELS.salesProductsForDay, (_event, date: unknown) =>
    toSalesResult(() => requireSalesService().productsForDay(date))
  )
  ipcMain.handle(IPC_CHANNELS.salesExportCsv, (_event, period: unknown) =>
    toSalesResultAsync(() => requireSalesExportService().exportCsv(period))
  )
  ipcMain.handle(
    IPC_CHANNELS.salesExportPdf,
    (_event, period: unknown, summaryGroups: unknown, reportType: unknown) =>
      toSalesResultAsync(() =>
        requireSalesExportService().exportPdf(period, summaryGroups, reportType)
      )
  )
  ipcMain.handle(IPC_CHANNELS.salesGetById, (_event, id: unknown) =>
    toSalesResult(() => requireSalesService().getById(id))
  )
}

async function saveSalesCsvFile(fileName: string, contents: string): Promise<boolean> {
  const options = {
    title: 'Export sales as CSV',
    buttonLabel: 'Export',
    defaultPath: fileName,
    filters: [{ name: 'CSV files', extensions: ['csv'] }]
  }
  const result = mainWindow
    ? await dialog.showSaveDialog(mainWindow, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return false

  await writeFile(result.filePath, contents, { encoding: 'utf8' })
  return true
}

async function saveSalesPdfFile(fileName: string, html: string): Promise<boolean> {
  const options = {
    title: 'Export sales report as PDF',
    buttonLabel: 'Export',
    defaultPath: fileName,
    filters: [{ name: 'PDF files', extensions: ['pdf'] }]
  }
  const result = mainWindow
    ? await dialog.showSaveDialog(mainWindow, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return false

  const pdf = await createSalesReportPdf(html)
  await writeFile(result.filePath, pdf)
  return true
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
  ipcMain.handle(IPC_CHANNELS.receiptsEmailDraft, (_event, saleId: unknown, recipient: unknown) =>
    toReceiptResult(() => requireReceiptService().emailDraft(saleId, recipient))
  )
  ipcMain.handle(IPC_CHANNELS.receiptsTextDraft, (_event, saleId: unknown, recipient: unknown) =>
    toReceiptResult(() => requireReceiptService().textDraft(saleId, recipient))
  )
  ipcMain.handle(IPC_CHANNELS.receiptsOpenPdf, (_event, saleId: unknown) =>
    toReceiptResult(() => requireReceiptService().openPdf(saleId))
  )
}

function registerBusinessSettingsHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.settingsGetBusiness, () =>
    toBusinessSettingsResult(() => requireBusinessSettingsService().get())
  )
  ipcMain.handle(IPC_CHANNELS.settingsSaveBusiness, (_event, settings: unknown) =>
    toBusinessSettingsResult(() => requireBusinessSettingsService().save(settings))
  )
  ipcMain.handle(IPC_CHANNELS.settingsGetTaxes, () =>
    toTaxSettingsResult(() => requireTaxSettingsService().get())
  )
  ipcMain.handle(IPC_CHANNELS.settingsSaveTaxes, (_event, settings: unknown) =>
    toTaxSettingsResult(() => requireTaxSettingsService().save(settings))
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

function requireSalesExportService(): NonNullable<typeof salesExportService> {
  if (!salesExportService) throw new Error('The sales export service is not ready.')
  return salesExportService
}

function requireReceiptService(): NonNullable<typeof receiptService> {
  if (!receiptService) throw new Error('The receipt service is not ready.')
  return receiptService
}

function requireBusinessSettingsService(): NonNullable<typeof businessSettingsService> {
  if (!businessSettingsService) throw new Error('The business settings service is not ready.')
  return businessSettingsService
}

function requireTaxSettingsService(): NonNullable<typeof taxSettingsService> {
  if (!taxSettingsService) throw new Error('The tax settings service is not ready.')
  return taxSettingsService
}

app.whenReady().then(() => {
  try {
    database = openDatabase(join(app.getPath('userData'), 'pos-system.sqlite'))
    repositories = createRepositories(database)
    repositories.settings.get()
    productService = createProductService(repositories.products)
    businessSettingsService = createBusinessSettingsService(repositories.settings)
    taxSettingsService = createTaxSettingsService(repositories.taxes)
    salesService = createSalesService(repositories.sales)
    salesExportService = createSalesExportService(
      salesService,
      saveSalesCsvFile,
      saveSalesPdfFile,
      () => requireBusinessSettingsService().get()
    )
    receiptService = createReceiptService({
      sales: repositories.sales,
      settings: repositories.settings,
      listSystemPrinters: async () => (await mainWindow?.webContents.getPrintersAsync()) ?? [],
      printHtml: printReceiptHtml,
      createPdf: createReceiptPdf,
      deletePdf: (path) => unlink(path),
      openEmailDraft: openWindowsEmailDraft,
      openExternal: (url) => shell.openExternal(url),
      showItemInFolder: (path) => shell.showItemInFolder(path)
    })
  } catch (error) {
    repositories = undefined
    productService = undefined
    businessSettingsService = undefined
    taxSettingsService = undefined
    salesService = undefined
    salesExportService = undefined
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
  registerBusinessSettingsHandlers()
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
