import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { IPC_CHANNELS, type BackupApiError, type BackupResult } from '../shared/pos-api'
import { createBackupScheduler } from './backup-scheduler'
import { BackupServiceError, createBackupService } from './backup-service'
import { openDatabase } from './database/connection'
import { createRepositories } from './database/repositories'
import type { PosDatabase } from './database/types'
import { createProductService, toProductResult } from './product-service'
import { createCustomerService, toCustomerResult } from './customer-service'
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
let backupService: ReturnType<typeof createBackupService> | undefined
let backupScheduler: ReturnType<typeof createBackupScheduler> | undefined
let repositories: ReturnType<typeof createRepositories> | undefined
let productService: ReturnType<typeof createProductService> | undefined
let customerService: ReturnType<typeof createCustomerService> | undefined
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

function registerCustomerHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.customersList, (_event, query: unknown) =>
    toCustomerResult(() => requireCustomerService().list(query))
  )
  ipcMain.handle(IPC_CHANNELS.customersCreate, (_event, input: unknown) =>
    toCustomerResult(() => requireCustomerService().create(input))
  )
  ipcMain.handle(IPC_CHANNELS.customersUpdate, (_event, id: unknown, input: unknown) =>
    toCustomerResult(() => requireCustomerService().update(id, input))
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
  ipcMain.handle(IPC_CHANNELS.receiptsPrintTest, () =>
    toReceiptResult(() => requireReceiptService().printTest())
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
  ipcMain.handle(IPC_CHANNELS.receiptsViewPdf, (_event, saleId: unknown) =>
    toReceiptResult(() => requireReceiptService().viewPdf(saleId))
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

async function toBackupResult<T>(operation: () => Promise<T> | T): Promise<BackupResult<T>> {
  try {
    return { ok: true, data: await operation() }
  } catch (error) {
    const apiError: BackupApiError =
      error instanceof BackupServiceError
        ? { code: error.code, message: error.message }
        : { code: 'internal', message: 'The backup operation could not be completed.' }
    if (!(error instanceof BackupServiceError)) console.error('Backup operation failed.', error)
    return { ok: false, error: apiError }
  }
}

function registerBackupHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.backupsGetStatus, () =>
    toBackupResult(() => requireBackupService().getStatus())
  )
  ipcMain.handle(IPC_CHANNELS.backupsChooseDestination, async () =>
    toBackupResult(async () => {
      const options = {
        title: 'Choose a backup folder on another drive',
        buttonLabel: 'Use this folder',
        properties: ['openDirectory', 'createDirectory'] as Array<
          'openDirectory' | 'createDirectory'
        >
      }
      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled || !result.filePaths[0]) return requireBackupService().getStatus()
      const status = await requireBackupService().setDestination(result.filePaths[0])
      backupScheduler?.destinationChanged()
      return status
    })
  )
  ipcMain.handle(IPC_CHANNELS.backupsRunManual, () =>
    toBackupResult(() => requireBackupService().runManual())
  )
  ipcMain.handle(IPC_CHANNELS.backupsRestore, async () => {
    const fileOptions = {
      title: 'Select a POS backup to restore',
      buttonLabel: 'Select backup',
      properties: ['openFile'] as Array<'openFile'>,
      filters: [{ name: 'POS database backups', extensions: ['sqlite'] }]
    }
    const fileResult = mainWindow
      ? await dialog.showOpenDialog(mainWindow, fileOptions)
      : await dialog.showOpenDialog(fileOptions)
    if (fileResult.canceled || !fileResult.filePaths[0]) {
      return { ok: true, data: { restored: false } } satisfies BackupResult<{ restored: boolean }>
    }

    const confirmationOptions = {
      type: 'warning' as const,
      title: 'Replace POS data?',
      message: 'Restoring this backup replaces all current POS data.',
      detail:
        'A safety copy of the current database will be saved before restoring. The app will restart after the restore.',
      buttons: ['Cancel', 'Restore backup'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    }
    const confirmation = mainWindow
      ? await dialog.showMessageBox(mainWindow, confirmationOptions)
      : await dialog.showMessageBox(confirmationOptions)
    if (confirmation.response !== 1) {
      return { ok: true, data: { restored: false } } satisfies BackupResult<{ restored: boolean }>
    }

    const result = await toBackupResult(async () => {
      await requireBackupService().restore(fileResult.filePaths[0])
      return { restored: true }
    })
    if (result.ok) {
      backupScheduler?.stop()
      setTimeout(() => {
        app.relaunch()
        app.exit(0)
      }, 500)
    } else if (errorClosedDatabase(result.error)) {
      backupScheduler?.stop()
      const messageOptions = {
        type: 'error' as const,
        title: 'Restore failed',
        message: result.error.message,
        detail: 'The previous database was restored. The app will now reopen.',
        buttons: ['Restart'],
        noLink: true
      }
      if (mainWindow) await dialog.showMessageBox(mainWindow, messageOptions)
      else dialog.showErrorBox(messageOptions.title, messageOptions.message)
      app.relaunch()
      app.exit(0)
    }
    return result
  })
}

function errorClosedDatabase(error: BackupApiError): boolean {
  return error.code === 'restore-failed' && Boolean(database && !database.open)
}

function requireProductService(): NonNullable<typeof productService> {
  if (!productService) throw new Error('The product service is not ready.')
  return productService
}

function requireCustomerService(): NonNullable<typeof customerService> {
  if (!customerService) throw new Error('The customer service is not ready.')
  return customerService
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

function requireBackupService(): NonNullable<typeof backupService> {
  if (!backupService) throw new Error('The backup service is not ready.')
  return backupService
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
    const userDataPath = app.getPath('userData')
    const databasePath = join(userDataPath, 'pos-system.sqlite')
    database = openDatabase(databasePath)
    backupService = createBackupService({
      database,
      databasePath,
      userDataPath,
      openStagedDatabase: openDatabase,
      supportedSchemaVersion: database.pragma('user_version', { simple: true }) as number
    })
    repositories = createRepositories(database)
    repositories.settings.get()
    customerService = createCustomerService(repositories.customers)
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
      openPath: (path) => shell.openPath(path),
      showItemInFolder: (path) => shell.showItemInFolder(path)
    })
  } catch (error) {
    repositories = undefined
    productService = undefined
    customerService = undefined
    businessSettingsService = undefined
    taxSettingsService = undefined
    salesService = undefined
    salesExportService = undefined
    receiptService = undefined
    backupService = undefined
    backupScheduler?.stop()
    backupScheduler = undefined
    database?.close()
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox('Unable to open the local database', message)
    app.quit()
    return
  }

  app.setAppUserModelId('com.regannguyen.possystem')

  ipcMain.handle(IPC_CHANNELS.appGetVersion, () => app.getVersion())
  registerCustomerHandlers()
  registerProductHandlers()
  registerBusinessSettingsHandlers()
  registerSalesHandlers()
  registerReceiptHandlers()
  registerBackupHandlers()
  createWindow()
  backupScheduler = createBackupScheduler(requireBackupService())
  backupScheduler.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  backupScheduler?.stop()
  if (database?.open) database.close()
})
