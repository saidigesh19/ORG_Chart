import { toCanvas } from 'html-to-image'
import { jsPDF } from 'jspdf'

const PADDING = 32
const PIXEL_RATIO = 2

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

function framedCanvas(source: HTMLCanvasElement, background: string): HTMLCanvasElement {
  const frame = document.createElement('canvas')
  frame.width = source.width + PADDING * PIXEL_RATIO * 2
  frame.height = source.height + PADDING * PIXEL_RATIO * 2
  const context = frame.getContext('2d')
  if (!context) {
    return source
  }
  context.fillStyle = background
  context.fillRect(0, 0, frame.width, frame.height)
  context.drawImage(source, PADDING * PIXEL_RATIO, PADDING * PIXEL_RATIO)
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
    const snapshot = await toCanvas(tree, {
      pixelRatio: PIXEL_RATIO,
      cacheBust: true,
      backgroundColor: background,
    })
    return framedCanvas(snapshot, background)
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
