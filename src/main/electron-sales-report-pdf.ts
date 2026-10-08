import { app, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function createSalesReportPdf(html: string): Promise<Buffer> {
  const htmlPath = join(app.getPath('temp'), `POS-Sales-Report-${randomUUID()}.html`)
  let pdfWindow: BrowserWindow | undefined

  try {
    await writeFile(htmlPath, html, 'utf8')
    pdfWindow = new BrowserWindow({
      show: false,
      width: 1100,
      height: 800,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    await pdfWindow.loadFile(htmlPath)
    return await pdfWindow.webContents.printToPDF({
      pageSize: 'Letter',
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0.45, bottom: 0.45, left: 0.45, right: 0.45 }
    })
  } finally {
    if (pdfWindow && !pdfWindow.isDestroyed()) pdfWindow.close()
    await unlink(htmlPath).catch(() => {})
  }
}
