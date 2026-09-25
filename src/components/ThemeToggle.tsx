import type { Theme } from '../lib/theme'

type ThemeToggleProps = {
  theme: Theme
  onChange: (theme: Theme) => void
}

export function ThemeToggle({ theme, onChange }: ThemeToggleProps) {
  const next = theme === 'dark' ? 'light' : 'dark'

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={next === 'dark' ? 'Switch to dark theme' : 'Switch to light theme'}
      title={next === 'dark' ? 'Dark theme' : 'Light theme'}
      onClick={() => onChange(next)}
    >
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  )
}
