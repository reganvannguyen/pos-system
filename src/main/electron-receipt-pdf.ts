import { app, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function createReceiptPdf(html: string, saleId: number): Promise<string> {
  const pdfWindow = new BrowserWindow({
    show: false,
    width: 420,
    height: 1200,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  try {
    await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const contentHeight = (await pdfWindow.webContents.executeJavaScript(
      'document.fonts.ready.then(() => document.body.scrollHeight)'
    )) as number
    const pdf = await pdfWindow.webContents.printToPDF({
      pageSize: { width: 58 / 25.4, height: Math.max(1.5, (contentHeight + 8) / 96) },
      printBackground: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    })
    const path = join(app.getPath('temp'), `POS-Receipt-${saleId}-${randomUUID()}.pdf`)
    await writeFile(path, pdf)
    return path
  } finally {
    if (!pdfWindow.isDestroyed()) pdfWindow.close()
  }
}
