import { BrowserWindow } from 'electron'

export async function printReceiptHtml(html: string, printerName: string): Promise<void> {
  const printWindow = new BrowserWindow({
    show: false,
    width: 420,
    height: 900,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  try {
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    await new Promise<void>((resolve, reject) => {
      printWindow.webContents.print(
        {
          silent: true,
          deviceName: printerName,
          printBackground: true,
          color: false,
          usePrinterDefaultPageSize: true,
          margins: { marginType: 'none' }
        },
        (success, failureReason) => {
          if (success) resolve()
          else reject(new Error(failureReason || 'The print job failed.'))
        }
      )
    })
  } finally {
    if (!printWindow.isDestroyed()) printWindow.close()
  }
}
