import { toCanvas } from 'html-to-image'
import { jsPDF } from 'jspdf'

const PADDING = 32
const PIXEL_RATIO = 2
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

export async function downloadChartImage(canvas: HTMLElement) {
  const image = await captureChartCanvas(canvas)
  const blob = await new Promise<Blob | null>((resolve) => image.toBlob(resolve, 'image/png'))
  if (!blob) {
    throw new Error('Could not create the image.')
  }
  triggerDownload(blob, `org-chart-${fileStamp()}.png`)
}

export async function downloadChartPdf(canvas: HTMLElement) {
  const image = await captureChartCanvas(canvas)
  const dataUrl = image.toDataURL('image/png')
  const max = 2400
  let width = image.width
  let height = image.height
  if (width > max || height > max) {
    const scale = Math.min(max / width, max / height)
    width = Math.round(width * scale)
    height = Math.round(height * scale)
  }

  const pdf = new jsPDF({
    orientation: width >= height ? 'landscape' : 'portrait',
    unit: 'px',
    format: [width, height],
    hotfixes: ['px_scaling'],
  })
  const [red, green, blue] = parseRgb(panelBackground())
  pdf.setFillColor(red, green, blue)
  pdf.rect(0, 0, width, height, 'F')
  pdf.addImage(dataUrl, 'PNG', 0, 0, width, height)
  pdf.save(`org-chart-${fileStamp()}.pdf`)
}
