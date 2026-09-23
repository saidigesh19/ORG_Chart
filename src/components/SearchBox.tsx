import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { OrgPath, SearchHit } from '../types/org'
import { searchPeople } from '../lib/org-tree'

type SearchBoxProps = {
  index: SearchHit[]
  onJump: (path: OrgPath) => void
}

export function SearchBox({ index, onJump }: SearchBoxProps) {
  const listId = useId()
  const inputId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const results = useMemo(() => searchPeople(index, query), [index, query])

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  function jump(hit: SearchHit) {
    onJump(hit.path)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="search" ref={rootRef}>
      <label className="sr-only" htmlFor={inputId}>
        Search people and teams
      </label>
      <input
        id={inputId}
        type="search"
        placeholder="Search by name or title"
        value={query}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        onChange={(event) => {
          setQuery(event.target.value)
          setActive(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActive((value) => Math.min(value + 1, Math.max(results.length - 1, 0)))
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActive((value) => Math.max(value - 1, 0))
          } else if (event.key === 'Enter' && results[active]) {
            event.preventDefault()
            jump(results[active])
          } else if (event.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {open && query.trim().length >= 2 ? (
        <ul id={listId} className="search-list" role="listbox">
          {results.length === 0 ? (
            <li className="search-empty">No matches</li>
          ) : (
            results.map((hit, index) => (
              <li key={hit.path.join('.') || 'root'} role="option" aria-selected={index === active}>
                <button
                  type="button"
                  className={index === active ? 'is-active' : undefined}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => jump(hit)}
                >
                  <span className="search-name">{hit.node.name}</span>
                  <span className="search-meta">
                    {hit.node.designation}
                    {hit.ancestors.length > 0 ? ` · ${hit.ancestors[hit.ancestors.length - 1]}` : ''}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  )
}
