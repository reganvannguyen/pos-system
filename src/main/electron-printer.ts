import { BrowserWindow, nativeImage } from 'electron'
import {
  monochromeReceiptBitmap,
  receiptRasterStrips,
  renderRasterPrintHtml
} from './receipt-raster'

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
    const contents = printWindow.webContents
    contents.debugger.attach('1.3')
    let screenshot: { data: string }
    try {
      await contents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
        width: Math.ceil((48 / 25.4) * 96),
        height: 900,
        deviceScaleFactor: 203 / 96,
        mobile: false
      })
      const bounds = (await contents.executeJavaScript(`(async () => {
        await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const rect = document.body.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: document.body.scrollHeight };
      })()`)) as { x: number; y: number; width: number; height: number }
      screenshot = await contents.debugger.sendCommand('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: { ...bounds, scale: 1 }
      })
      await contents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride')
    } finally {
      if (contents.debugger.isAttached()) contents.debugger.detach()
    }

    const receiptImage = nativeImage
      .createFromBuffer(Buffer.from(screenshot.data, 'base64'))
      .resize({ width: 384, quality: 'best' })
    if (receiptImage.isEmpty()) throw new Error('Receipt image could not be rendered.')
    const { width, height } = receiptImage.getSize()
    const bitmap = monochromeReceiptBitmap(receiptImage.toBitmap())
    const imageUrls = receiptRasterStrips(bitmap, width, height).map((strip) =>
      nativeImage
        .createFromBitmap(strip, { width, height: strip.length / (width * 4), scaleFactor: 1 })
        .toDataURL()
    )

    await printWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(renderRasterPrintHtml(imageUrls))}`
    )
    await contents.executeJavaScript(
      `Promise.all(Array.from(document.images, image => image.decode()))`
    )
    await new Promise<void>((resolve, reject) => {
      contents.print(
        {
          silent: true,
          deviceName: printerName,
          printBackground: true,
          color: false,
          scaleFactor: 100,
          usePrinterDefaultPageSize: true,
          margins: { marginType: 'printableArea' }
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
