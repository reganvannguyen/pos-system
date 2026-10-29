import { BrowserWindow, nativeImage } from 'electron'
import {
  monochromeReceiptBitmap,
  receiptRasterStrips,
  renderRasterPrintHtml
} from './receipt-raster'

// Receipt paper width in CSS pixels at 96 dpi (48 mm printable area).
const RECEIPT_CSS_WIDTH = Math.ceil((48 / 25.4) * 96)

// Target raster width in physical printer dots (203 dpi * 48 mm / 25.4).
const RECEIPT_PRINTER_WIDTH = 384

export async function printReceiptHtml(html: string, printerName: string): Promise<void> {
  // Create the hidden window at exactly the receipt CSS width so the HTML
  // lays out at the correct column width without needing a device-metrics override.
  const printWindow = new BrowserWindow({
    show: false,
    useContentSize: true,
    width: RECEIPT_CSS_WIDTH,
    height: 1200,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  try {
    const noScrollHtml = html
      .replace(
        '</head>',
        '<style>body{max-width:42mm!important;margin:0 auto!important;padding:0!important;font-weight:var(--receipt-font-weight)!important;letter-spacing:0.25px!important;-webkit-font-smoothing:antialiased!important}h1{font-weight:var(--receipt-title-font-weight)!important;letter-spacing:0.5px!important}html,body{overflow:hidden!important;scrollbar-width:none!important}::-webkit-scrollbar{display:none!important}</style></head>'
      )
      .replace(
        '<header>',
        '<header><div style="border-top:1px solid #000;margin:2px 0 8px 0;width:100%;"></div>'
      )
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(noScrollHtml)}`)
    const contents = printWindow.webContents

    // Wait for fonts and two animation frames so the layout is fully settled.
    const scrollHeight = (await contents.executeJavaScript(`(async () => {
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return Math.ceil(Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
        document.body.offsetHeight,
        document.documentElement.offsetHeight
      )) + 24;
    })()`)) as number

    // Resize the window to the full content height so capturePage() sees
    // everything, then wait one more frame for the resize to apply.
    printWindow.setContentSize(RECEIPT_CSS_WIDTH, scrollHeight)
    await contents.executeJavaScript(
      `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`
    )

    // capturePage() is the Electron-native screenshot API — it never hangs
    // unlike the CDP Page.captureScreenshot command on some Windows setups.
    const captured = await contents.capturePage({
      x: 0,
      y: 0,
      width: RECEIPT_CSS_WIDTH,
      height: scrollHeight
    })

    // Scale to the physical printer dot width (384 px = 203 dpi × 48 mm).
    const receiptImage = captured.resize({ width: RECEIPT_PRINTER_WIDTH, quality: 'best' })
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
          margins: { marginType: 'none' }
        },
        (success, failureReason) => {
          if (success) resolve()
          else reject(new Error(failureReason || 'The print job failed.'))
        }
      )
    })
    // Give Windows print spooler time to dispatch before window teardown
    await new Promise((resolve) => setTimeout(resolve, 1500))
  } finally {
    if (!printWindow.isDestroyed()) printWindow.close()
  }
}
