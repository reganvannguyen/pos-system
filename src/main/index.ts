import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { IPC_CHANNELS } from '../shared/pos-api'
import { openDatabase } from './database/connection'
import { createRepositories } from './database/repositories'
import type { PosDatabase } from './database/types'

let database: PosDatabase | undefined
let repositories: ReturnType<typeof createRepositories> | undefined

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

app.whenReady().then(() => {
  try {
    database = openDatabase(join(app.getPath('userData'), 'pos-system.sqlite'))
    repositories = createRepositories(database)
    repositories.settings.get()
  } catch (error) {
    repositories = undefined
    database?.close()
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox('Unable to open the local database', message)
    app.quit()
    return
  }

  app.setAppUserModelId('com.regannguyen.possystem')

  ipcMain.handle(IPC_CHANNELS.appGetVersion, () => app.getVersion())
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
