import { toCanvas } from 'html-to-image'
import { jsPDF } from 'jspdf'

const PADDING = 32
const PIXEL_RATIO = 2
const PRINT_DPI = 150
const PAGE_MARGIN_MM = 8

export type PaperSize = 'a4' | 'a3' | 'letter' | 'tabloid'
export type PageOrientation = 'landscape' | 'portrait'
export type PageDepth = 'current' | 0 | 1 | 2

export type PdfPageSetup = {
  depth: PageDepth
  branchKeys: string[]
}

export type ChartExportSetup = {
  size: PaperSize
  orientation: PageOrientation
  pages: PdfPageSetup[]
}

export const PAPER_SIZES: { id: PaperSize; label: string; mm: [number, number] }[] = [
  { id: 'a4', label: 'A4', mm: [210, 297] },
  { id: 'a3', label: 'A3', mm: [297, 420] },
  { id: 'letter', label: 'Letter', mm: [215.9, 279.4] },
  { id: 'tabloid', label: 'Tabloid', mm: [279.4, 431.8] },
]
const BADGE_SRC = '/icon2.webp'
const WORDMARK_SRC = '/icon1.png'
const BADGE_HEIGHT = 72
const WORDMARK_HEIGHT = 40
const LOCKUP_GAP = 14
const LOGO_GAP = 16

function fileStamp(): string {
  return new Date().toISOString().slice(0, 10)
}

function panelBackground(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--panel').trim()
  return value || '#ffffff'
}

function parseRgb(color: string): [number, number, number] {
  const match = color.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i)
  if (match) {
    return [Number(match[1]), Number(match[2]), Number(match[3])]
  }
  if (color.startsWith('#')) {
    const hex = color.slice(1)
    const full = hex.length === 3 ? hex.split('').map((part) => part + part).join('') : hex
    return [Number.parseInt(full.slice(0, 2), 16), Number.parseInt(full.slice(2, 4), 16), Number.parseInt(full.slice(4, 6), 16)]
  }
  return document.documentElement.dataset.theme === 'dark' ? [22, 28, 36] : [255, 255, 255]
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Could not load ${src}.`))
    image.src = src
  })
}

function scaledSize(image: HTMLImageElement, height: number): { width: number; height: number } {
  return {
    width: Math.round(height * (image.naturalWidth / Math.max(image.naturalHeight, 1))),
    height,
  }
}

function framedCanvas(
  source: HTMLCanvasElement,
  background: string,
  badge: HTMLImageElement,
  wordmark: HTMLImageElement,
): HTMLCanvasElement {
  const pad = PADDING * PIXEL_RATIO
  const badgeSize = scaledSize(badge, BADGE_HEIGHT * PIXEL_RATIO)
  const wordmarkSize = scaledSize(wordmark, WORDMARK_HEIGHT * PIXEL_RATIO)
  const lockupGap = LOCKUP_GAP * PIXEL_RATIO
  const lockupWidth = badgeSize.width + lockupGap + wordmarkSize.width
  const top = pad + badgeSize.height + LOGO_GAP * PIXEL_RATIO
  const frame = document.createElement('canvas')
  frame.width = Math.max(source.width + pad * 2, lockupWidth + pad * 2)
  frame.height = source.height + top + pad
  const context = frame.getContext('2d')
  if (!context) {
    return source
  }
  context.fillStyle = background
  context.fillRect(0, 0, frame.width, frame.height)
  context.drawImage(badge, pad, pad, badgeSize.width, badgeSize.height)
  const wordX = pad + badgeSize.width + lockupGap
  const wordY = pad + (badgeSize.height - wordmarkSize.height) / 2
  if (document.documentElement.dataset.theme === 'dark') {
    context.save()
    context.filter = 'invert(1) hue-rotate(180deg)'
    context.drawImage(wordmark, wordX, wordY, wordmarkSize.width, wordmarkSize.height)
    context.restore()
  } else {
    context.drawImage(wordmark, wordX, wordY, wordmarkSize.width, wordmarkSize.height)
  }
  context.drawImage(source, pad, top)
  return frame
}

export async function captureChartCanvas(canvas: HTMLElement): Promise<HTMLCanvasElement> {
  const tree = canvas.querySelector<HTMLElement>(':scope > .org-node') ?? canvas
  const previousZoom = canvas.style.getPropertyValue('--chart-zoom')
  canvas.style.setProperty('--chart-zoom', '1')
  const background = panelBackground()

  try {
    await document.fonts.ready
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    const [snapshot, badge, wordmark] = await Promise.all([
      toCanvas(tree, {
        pixelRatio: PIXEL_RATIO,
        cacheBust: true,
        backgroundColor: background,
      }),
      loadImage(BADGE_SRC),
      loadImage(WORDMARK_SRC),
    ])
    return framedCanvas(snapshot, background, badge, wordmark)
  } finally {
    if (previousZoom) {
      canvas.style.setProperty('--chart-zoom', previousZoom)
    } else {
      canvas.style.removeProperty('--chart-zoom')
    }
  }
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function paperPixels(size: PaperSize, orientation: PageOrientation): { width: number; height: number } {
  const spec = PAPER_SIZES.find((paper) => paper.id === size) ?? PAPER_SIZES[0]
  const [shortSide, longSide] = spec.mm
  const mmWidth = orientation === 'landscape' ? longSide : shortSide
  const mmHeight = orientation === 'landscape' ? shortSide : longSide
  return {
    width: Math.round((mmWidth / 25.4) * PRINT_DPI),
    height: Math.round((mmHeight / 25.4) * PRINT_DPI),
  }
}

/** Fit a captured chart onto a page of the chosen size and orientation. */
export function placeChartOnPaper(
  source: HTMLCanvasElement,
  size: PaperSize,
  orientation: PageOrientation,
): HTMLCanvasElement {
  const { width, height } = paperPixels(size, orientation)
  const page = document.createElement('canvas')
  page.width = width
  page.height = height
  const context = page.getContext('2d')
  if (!context) {
    throw new Error('Could not prepare the page.')
  }
  const background = panelBackground()
  context.fillStyle = background
  context.fillRect(0, 0, width, height)
  const margin = Math.round((PAGE_MARGIN_MM / 25.4) * PRINT_DPI)
  const maxWidth = Math.max(width - margin * 2, 1)
  const maxHeight = Math.max(height - margin * 2, 1)
  const scale = Math.min(maxWidth / source.width, maxHeight / source.height, 2)
  const drawWidth = Math.round(source.width * scale)
  const drawHeight = Math.round(source.height * scale)
  context.drawImage(source, Math.round((width - drawWidth) / 2), Math.round((height - drawHeight) / 2), drawWidth, drawHeight)
  return page
}

export async function downloadChartImage(
  canvas: HTMLElement,
  setup: Pick<ChartExportSetup, 'size' | 'orientation'>,
) {
  const image = await captureChartCanvas(canvas)
  const page = placeChartOnPaper(image, setup.size, setup.orientation)
  const blob = await new Promise<Blob | null>((resolve) => page.toBlob(resolve, 'image/png'))
  if (!blob) {
    throw new Error('Could not create the image.')
  }
  triggerDownload(blob, `org-chart-${setup.size}-${setup.orientation}-${fileStamp()}.png`)
}

export async function downloadChartPdf(pages: HTMLCanvasElement[], setup: ChartExportSetup) {
  if (pages.length === 0) {
    throw new Error('Choose at least one page.')
  }
  const pdf = new jsPDF({
    orientation: setup.orientation,
    unit: 'mm',
    format: setup.size,
  })
  const [red, green, blue] = parseRgb(panelBackground())
  const width = pdf.internal.pageSize.getWidth()
  const height = pdf.internal.pageSize.getHeight()
  pages.forEach((page, index) => {
    if (index > 0) {
      pdf.addPage(setup.size, setup.orientation)
    }
    pdf.setFillColor(red, green, blue)
    pdf.rect(0, 0, width, height, 'F')
    pdf.addImage(page.toDataURL('image/png'), 'PNG', 0, 0, width, height)
  })
  pdf.save(`org-chart-${setup.size}-${setup.orientation}-${fileStamp()}.pdf`)
}
