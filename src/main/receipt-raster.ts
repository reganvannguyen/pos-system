// NativeImage bitmaps use four bytes per pixel. Equal RGB values also work across
// platform channel ordering; flatten transparency onto white before thresholding.
export function monochromeReceiptBitmap(bitmap: Buffer): Buffer {
  const result = Buffer.alloc(bitmap.length)
  for (let offset = 0; offset < bitmap.length; offset += 4) {
    const alpha = bitmap[offset + 3] / 255
    const brightness =
      ((bitmap[offset] + bitmap[offset + 1] + bitmap[offset + 2]) / 3) * alpha + 255 * (1 - alpha)
    const value = brightness < 150 ? 0 : 255
    result[offset] = value
    result[offset + 1] = value
    result[offset + 2] = value
    result[offset + 3] = 255
  }
  return result
}

export function receiptRasterStrips(bitmap: Buffer, width: number, height: number): Buffer[] {
  const strips: Buffer[] = []
  // Small strips keep page-boundary whitespace below 8 mm on a 203 dpi printer.
  for (let row = 0; row < height; row += 64) {
    strips.push(bitmap.subarray(row * width * 4, Math.min(height, row + 64) * width * 4))
  }
  return strips
}

export function addVerticalPadding(
  bitmap: Buffer,
  width: number,
  height: number,
  topRows: number,
  bottomRows: number
): { bitmap: Buffer; height: number } {
  const newHeight = height + topRows + bottomRows
  const rowBytes = width * 4
  const result = Buffer.alloc(newHeight * rowBytes, 255)
  bitmap.copy(result, topRows * rowBytes)
  return { bitmap: result, height: newHeight }
}

export function renderRasterPrintHtml(imageUrls: string[]): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 0; }
    img { display: block; width: 48mm; max-width: 100%; height: auto; margin: 0;
      break-inside: avoid; page-break-inside: avoid; }
  </style></head><body>${imageUrls.map((url) => `<img src="${url}" alt="">`).join('')}</body></html>`
}
