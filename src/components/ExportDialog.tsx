import { useEffect, useId, useRef, useState } from 'react'
import {
  PAPER_SIZES,
  type ChartExportSetup,
  type PageDepth,
  type PageOrientation,
  type PaperSize,
  type PdfPageSetup,
} from '../lib/export-chart'

const PAGE_LIMIT = 8

const DEPTHS: { id: PageDepth; label: string }[] = [
  { id: 'current', label: 'Current' },
  { id: 0, label: 'Top' },
  { id: 1, label: 'L1' },
  { id: 2, label: 'L2' },
]

type BranchChoice = { key: string; name: string }

type ExportDialogProps = {
  kind: 'image' | 'pdf'
  branches: BranchChoice[]
  busy: boolean
  status: string | null
  onClose: () => void
  onConfirm: (setup: ChartExportSetup) => void
}

function chunkBranches(keys: string[], count: number): string[][] {
  if (count <= 1) {
    return [keys]
  }
  const size = Math.ceil(keys.length / count)
  return Array.from({ length: count }, (_, index) => {
    const slice = keys.slice(index * size, (index + 1) * size)
    return slice.length > 0 ? slice : [...keys]
  })
}

function assignPages(count: number, keys: string[], previous: PdfPageSetup[]): PdfPageSetup[] {
  return chunkBranches(keys, count).map((branchKeys, index) => ({
    depth: previous[index]?.depth ?? 'current',
    branchKeys,
  }))
}

export function ExportDialog({ kind, branches, busy, status, onClose, onConfirm }: ExportDialogProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const branchKeys = branches.map((branch) => branch.key)
  const [size, setSize] = useState<PaperSize>('a4')
  const [orientation, setOrientation] = useState<PageOrientation>('landscape')
  const [pages, setPages] = useState<PdfPageSetup[]>(() => assignPages(1, branchKeys, []))

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus()
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const pagesReady = kind === 'image' || branches.length === 0 || pages.every((page) => page.branchKeys.length > 0)

  function setPageCount(count: number) {
    const next = Math.min(PAGE_LIMIT, Math.max(1, count))
    setPages((current) => assignPages(next, branchKeys, current))
  }

  function setPageDepth(index: number, depth: PageDepth) {
    setPages((current) => current.map((page, pageIndex) => (pageIndex === index ? { ...page, depth } : page)))
  }

  function setPageBranches(index: number, keys: string[]) {
    setPages((current) => current.map((page, pageIndex) => (pageIndex === index ? { ...page, branchKeys: keys } : page)))
  }

  function togglePageBranch(index: number, key: string) {
    setPages((current) =>
      current.map((page, pageIndex) => {
        if (pageIndex !== index) {
          return page
        }
        const branchKeysOnPage = page.branchKeys.includes(key)
          ? page.branchKeys.filter((item) => item !== key)
          : [...page.branchKeys, key]
        return { ...page, branchKeys: branchKeysOnPage }
      }),
    )
  }

  return (
    <div
      className="export-dialog-backdrop"
      onPointerDown={(event) => {
        if (!busy && event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        className="export-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy}
      >
        <header className="export-dialog-head">
          <h2 id={titleId}>{kind === 'pdf' ? 'Download PDF' : 'Download image'}</h2>
          <p>
            {kind === 'pdf'
              ? 'Choose the page size, orientation, how many pages, and what each page includes.'
              : 'Choose the page size and orientation. The chart is fitted onto that page.'}
          </p>
        </header>

        <div className="export-dialog-body">
          <div className="export-field">
            <p className="export-label">Size</p>
            <div className="export-choice" role="group" aria-label="Page size">
              {PAPER_SIZES.map((paper) => (
                <button
                  key={paper.id}
                  type="button"
                  className={size === paper.id ? 'is-active' : undefined}
                  aria-pressed={size === paper.id}
                  disabled={busy}
                  onClick={() => setSize(paper.id)}
                >
                  {paper.label}
                </button>
              ))}
            </div>
          </div>

          <div className="export-field">
            <p className="export-label">Orientation</p>
            <div className="export-choice" role="group" aria-label="Page orientation">
              <button
                type="button"
                className={orientation === 'landscape' ? 'is-active' : undefined}
                aria-pressed={orientation === 'landscape'}
                disabled={busy}
                onClick={() => setOrientation('landscape')}
              >
                Landscape
              </button>
              <button
                type="button"
                className={orientation === 'portrait' ? 'is-active' : undefined}
                aria-pressed={orientation === 'portrait'}
                disabled={busy}
                onClick={() => setOrientation('portrait')}
              >
                Portrait
              </button>
            </div>
          </div>

          {kind === 'pdf' ? (
            <>
              <div className="export-field">
                <p className="export-label">Pages</p>
                <div className="export-stepper" role="group" aria-label="Number of pages">
                  <button
                    type="button"
                    aria-label="Fewer pages"
                    disabled={busy || pages.length <= 1}
                    onClick={() => setPageCount(pages.length - 1)}
                  >
                    −
                  </button>
                  <span>
                    {pages.length} {pages.length === 1 ? 'page' : 'pages'}
                  </span>
                  <button
                    type="button"
                    aria-label="More pages"
                    disabled={busy || pages.length >= PAGE_LIMIT}
                    onClick={() => setPageCount(pages.length + 1)}
                  >
                    +
                  </button>
                </div>
                <p className="export-hint">
                  Changing the page count splits the teams across the pages again. Set what each page shows before you
                  download.
                </p>
              </div>

              {pages.map((page, index) => (
                <fieldset className="export-page" key={index} disabled={busy}>
                  <legend>Page {index + 1}</legend>
                  <p className="export-label">Show</p>
                  <div className="export-choice" role="group" aria-label={`Level on page ${index + 1}`}>
                    {DEPTHS.map((depth) => (
                      <button
                        key={String(depth.id)}
                        type="button"
                        className={page.depth === depth.id ? 'is-active' : undefined}
                        aria-pressed={page.depth === depth.id}
                        onClick={() => setPageDepth(index, depth.id)}
                      >
                        {depth.label}
                      </button>
                    ))}
                  </div>
                  <p className="export-hint">
                    Current keeps the chart as open as it is now. Top is leadership only. L1 and L2 open the teams you
                    select.
                  </p>
                  {branches.length > 0 ? (
                    <>
                      <div className="export-page-tools">
                        <p className="export-label">Teams</p>
                        <button type="button" onClick={() => setPageBranches(index, branchKeys)}>
                          All
                        </button>
                        <button type="button" onClick={() => setPageBranches(index, [])}>
                          None
                        </button>
                      </div>
                      <div className="export-branches" role="group" aria-label={`Teams on page ${index + 1}`}>
                        {branches.map((branch) => (
                          <label key={branch.key} className="export-branch" title={branch.name}>
                            <input
                              type="checkbox"
                              checked={page.branchKeys.includes(branch.key)}
                              onChange={() => togglePageBranch(index, branch.key)}
                            />
                            <span>{branch.name}</span>
                          </label>
                        ))}
                      </div>
                      {page.branchKeys.length === 0 ? (
                        <p className="export-warn">Choose at least one team for this page.</p>
                      ) : null}
                    </>
                  ) : null}
                </fieldset>
              ))}
            </>
          ) : null}
        </div>

        <footer className="export-dialog-foot">
          {status ? (
            <p className="export-status" aria-live="polite">
              {status}
            </p>
          ) : null}
          <button type="button" className="export-secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="export-primary"
            disabled={busy || !pagesReady}
            onClick={() => onConfirm({ size, orientation, pages: kind === 'pdf' ? pages : [] })}
          >
            {busy ? 'Saving…' : 'Download'}
          </button>
        </footer>
      </div>
    </div>
  )
}
