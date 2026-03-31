type Theme = {
  theme: Record<string, unknown>
  [key: string]: unknown
}

type Map = Record<string, Theme>

let pluginThemes: Map = {}
let customThemes: Map = {}
let systemTheme: Theme | undefined
let push: ((themes: Map) => void) | undefined

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isTheme(theme: unknown): theme is Theme {
  return isRecord(theme) && isRecord(theme.theme)
}

function sync() {
  push?.(allThemes())
}

export function bindThemeStore(fn?: (themes: Map) => void) {
  push = fn
  sync()
}

export function setCustomThemes(map: Map) {
  customThemes = map
  sync()
}

export function setSystemTheme(theme?: Theme) {
  systemTheme = theme
  sync()
}

export function allThemes() {
  const next = {
    ...pluginThemes,
    ...customThemes,
  }

  if (!systemTheme) return next
  return {
    ...next,
    system: systemTheme,
  }
}

export function hasTheme(name: string) {
  if (!name) return false
  return allThemes()[name] !== undefined
}

export function addTheme(name: string, theme: unknown) {
  if (!name) return false
  if (!isTheme(theme)) return false
  if (hasTheme(name)) return false
  pluginThemes[name] = theme
  sync()
  return true
}

export { allThemes as themes }

export function upsertTheme(name: string, theme: unknown) {
  if (!name) return false
  if (!isTheme(theme)) return false
  if (customThemes[name] !== undefined) {
    customThemes[name] = theme
  } else {
    pluginThemes[name] = theme
  }
  sync()
  return true
}
