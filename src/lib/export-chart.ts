import { toCanvas } from 'html-to-image'
import { jsPDF } from 'jspdf'

const PIXEL_RATIO = 2
const PRINT_DPI = 150
const PAGE_MARGIN_MM = 8
const CSS_REFERENCE_DPI = 96
/** Header sizes from `.app-bar`, `.app-mark`, and `.app-logo`. */
const BAR_CSS_HEIGHT = 54 + 17
const WORDMARK_CSS_HEIGHT = 44
const WORDMARK_CSS_WIDTH = 44 * (200 / 99)
const WORDMARK_POSITION_Y = 0.485
const CHART_GAP_CSS = 16

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

export type ChartCapture = {
  chart: HTMLCanvasElement
  background: string
  badge: HTMLImageElement
  wordmark: HTMLImageElement
}

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

function cssToPage(px: number): number {
  return px * (PRINT_DPI / CSS_REFERENCE_DPI)
}

/** Same crop as `.app-logo`: object-fit cover, object-position center 48.5%. */
function wordmarkCrop(image: HTMLImageElement): { x: number; y: number; width: number; height: number } {
  const destWidth = 200
  const destHeight = 99
  const scale = Math.max(destWidth / image.naturalWidth, destHeight / image.naturalHeight)
  const offsetY = (destHeight - image.naturalHeight * scale) * WORDMARK_POSITION_Y
  const y = Math.max(0, -offsetY / scale)
  const height = Math.min(image.naturalHeight - y, destHeight / scale)
  return { x: 0, y, width: image.naturalWidth, height }
}

function drawWordmark(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const crop = wordmarkCrop(image)
  context.save()
  if (document.documentElement.dataset.theme === 'dark') {
    context.filter = 'invert(1) hue-rotate(180deg)'
  }
  context.drawImage(image, crop.x, crop.y, crop.width, crop.height, x, y, width, height)
  context.restore()
}

export async function captureChartCanvas(canvas: HTMLElement): Promise<ChartCapture> {
  const tree = canvas.querySelector<HTMLElement>(':scope > .org-node') ?? canvas
  const previousZoom = canvas.style.getPropertyValue('--chart-zoom')
  canvas.style.setProperty('--chart-zoom', '1')
  canvas.dispatchEvent(new Event('chart-relayout'))
  const background = panelBackground()

  try {
    await document.fonts.ready
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    const [chart, badge, wordmark] = await Promise.all([
      toCanvas(tree, {
        pixelRatio: PIXEL_RATIO,
        cacheBust: true,
        backgroundColor: background,
      }),
      loadImage(BADGE_SRC),
      loadImage(WORDMARK_SRC),
    ])
    return { chart, background, badge, wordmark }
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

/** Fit a captured chart onto a page, with the wordmark at the on-screen header size. */
export function placeChartOnPaper(
  capture: ChartCapture,
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
  context.fillStyle = capture.background
  context.fillRect(0, 0, width, height)
  const margin = Math.round((PAGE_MARGIN_MM / 25.4) * PRINT_DPI)
  const barHeight = cssToPage(BAR_CSS_HEIGHT)
  const badgeHeight = barHeight * (362 / 213)
  const badgeWidth = barHeight * (256 / 213)
  const wordmarkHeight = cssToPage(WORDMARK_CSS_HEIGHT)
  const wordmarkWidth = cssToPage(WORDMARK_CSS_WIDTH)
  const wordmarkX = margin + cssToPage((54 + 16) * (256 / 213) + 14)
  const wordmarkY = margin + (barHeight - wordmarkHeight) / 2
  context.drawImage(capture.badge, margin, margin, badgeWidth, badgeHeight)
  drawWordmark(context, capture.wordmark, wordmarkX, wordmarkY, wordmarkWidth, wordmarkHeight)

  const contentTop = margin + badgeHeight + cssToPage(CHART_GAP_CSS)
  const maxWidth = Math.max(width - margin * 2, 1)
  const maxHeight = Math.max(height - contentTop - margin, 1)
  const scale = Math.min(maxWidth / capture.chart.width, maxHeight / capture.chart.height, 2)
  const drawWidth = Math.round(capture.chart.width * scale)
  const drawHeight = Math.round(capture.chart.height * scale)
  context.drawImage(
    capture.chart,
    Math.round((width - drawWidth) / 2),
    Math.round(contentTop),
    drawWidth,
    drawHeight,
  )
  return page
}

export async function downloadChartImage(
  canvas: HTMLElement,
  setup: Pick<ChartExportSetup, 'size' | 'orientation'>,
) {
  const capture = await captureChartCanvas(canvas)
  const page = placeChartOnPaper(capture, setup.size, setup.orientation)
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
