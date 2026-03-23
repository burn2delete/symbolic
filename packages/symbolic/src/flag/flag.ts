function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

function falsy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "false" || value === "0"
}

export namespace Flag {
  export const SYMBOLIC_AUTO_SHARE = truthy("SYMBOLIC_AUTO_SHARE")
  export const SYMBOLIC_GIT_BASH_PATH = process.env["SYMBOLIC_GIT_BASH_PATH"]
  export const SYMBOLIC_CONFIG = process.env["SYMBOLIC_CONFIG"]
  export declare const SYMBOLIC_TUI_CONFIG: string | undefined
  export declare const SYMBOLIC_CONFIG_DIR: string | undefined
  export const SYMBOLIC_CONFIG_CONTENT = process.env["SYMBOLIC_CONFIG_CONTENT"]
  export const SYMBOLIC_DISABLE_AUTOUPDATE = truthy("SYMBOLIC_DISABLE_AUTOUPDATE")
  export const SYMBOLIC_DISABLE_PRUNE = truthy("SYMBOLIC_DISABLE_PRUNE")
  export const SYMBOLIC_DISABLE_TERMINAL_TITLE = truthy("SYMBOLIC_DISABLE_TERMINAL_TITLE")
  export const SYMBOLIC_PERMISSION = process.env["SYMBOLIC_PERMISSION"]
  export const SYMBOLIC_DISABLE_DEFAULT_PLUGINS = truthy("SYMBOLIC_DISABLE_DEFAULT_PLUGINS")
  export const SYMBOLIC_DISABLE_LSP_DOWNLOAD = truthy("SYMBOLIC_DISABLE_LSP_DOWNLOAD")
  export const SYMBOLIC_ENABLE_EXPERIMENTAL_MODELS = truthy("SYMBOLIC_ENABLE_EXPERIMENTAL_MODELS")
  export const SYMBOLIC_DISABLE_AUTOCOMPACT = truthy("SYMBOLIC_DISABLE_AUTOCOMPACT")
  export const SYMBOLIC_DISABLE_MODELS_FETCH = truthy("SYMBOLIC_DISABLE_MODELS_FETCH")
  export const SYMBOLIC_DISABLE_CLAUDE_CODE = truthy("SYMBOLIC_DISABLE_CLAUDE_CODE")
  export const SYMBOLIC_DISABLE_CLAUDE_CODE_PROMPT =
    SYMBOLIC_DISABLE_CLAUDE_CODE || truthy("SYMBOLIC_DISABLE_CLAUDE_CODE_PROMPT")
  export const SYMBOLIC_DISABLE_CLAUDE_CODE_SKILLS =
    SYMBOLIC_DISABLE_CLAUDE_CODE || truthy("SYMBOLIC_DISABLE_CLAUDE_CODE_SKILLS")
  export const SYMBOLIC_DISABLE_EXTERNAL_SKILLS =
    SYMBOLIC_DISABLE_CLAUDE_CODE_SKILLS || truthy("SYMBOLIC_DISABLE_EXTERNAL_SKILLS")
  export declare const SYMBOLIC_DISABLE_PROJECT_CONFIG: boolean
  export const SYMBOLIC_FAKE_VCS = process.env["SYMBOLIC_FAKE_VCS"]
  export declare const SYMBOLIC_CLIENT: string
  export const SYMBOLIC_SERVER_PASSWORD = process.env["SYMBOLIC_SERVER_PASSWORD"]
  export const SYMBOLIC_SERVER_USERNAME = process.env["SYMBOLIC_SERVER_USERNAME"]
  export const SYMBOLIC_ENABLE_QUESTION_TOOL = truthy("SYMBOLIC_ENABLE_QUESTION_TOOL")

  // Experimental
  export const SYMBOLIC_EXPERIMENTAL = truthy("SYMBOLIC_EXPERIMENTAL")
  export const SYMBOLIC_EXPERIMENTAL_FILEWATCHER = truthy("SYMBOLIC_EXPERIMENTAL_FILEWATCHER")
  export const SYMBOLIC_EXPERIMENTAL_DISABLE_FILEWATCHER = truthy("SYMBOLIC_EXPERIMENTAL_DISABLE_FILEWATCHER")
  export const SYMBOLIC_EXPERIMENTAL_ICON_DISCOVERY =
    SYMBOLIC_EXPERIMENTAL || truthy("SYMBOLIC_EXPERIMENTAL_ICON_DISCOVERY")

  const copy = process.env["SYMBOLIC_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
  export const SYMBOLIC_EXPERIMENTAL_DISABLE_COPY_ON_SELECT =
    copy === undefined ? process.platform === "win32" : truthy("SYMBOLIC_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const SYMBOLIC_ENABLE_EXA =
    truthy("SYMBOLIC_ENABLE_EXA") || SYMBOLIC_EXPERIMENTAL || truthy("SYMBOLIC_EXPERIMENTAL_EXA")
  export const SYMBOLIC_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("SYMBOLIC_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")
  export const SYMBOLIC_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("SYMBOLIC_EXPERIMENTAL_OUTPUT_TOKEN_MAX")
  export const SYMBOLIC_EXPERIMENTAL_OXFMT = SYMBOLIC_EXPERIMENTAL || truthy("SYMBOLIC_EXPERIMENTAL_OXFMT")
  export const SYMBOLIC_EXPERIMENTAL_LSP_TY = truthy("SYMBOLIC_EXPERIMENTAL_LSP_TY")
  export const SYMBOLIC_EXPERIMENTAL_LSP_TOOL = SYMBOLIC_EXPERIMENTAL || truthy("SYMBOLIC_EXPERIMENTAL_LSP_TOOL")
  export const SYMBOLIC_DISABLE_FILETIME_CHECK = truthy("SYMBOLIC_DISABLE_FILETIME_CHECK")
  export const SYMBOLIC_EXPERIMENTAL_PLAN_MODE = SYMBOLIC_EXPERIMENTAL || truthy("SYMBOLIC_EXPERIMENTAL_PLAN_MODE")
  export const SYMBOLIC_EXPERIMENTAL_WORKSPACES = SYMBOLIC_EXPERIMENTAL || truthy("SYMBOLIC_EXPERIMENTAL_WORKSPACES")
  export const SYMBOLIC_EXPERIMENTAL_MARKDOWN = !falsy("SYMBOLIC_EXPERIMENTAL_MARKDOWN")
  export const SYMBOLIC_MODELS_URL = process.env["SYMBOLIC_MODELS_URL"]
  export const SYMBOLIC_MODELS_PATH = process.env["SYMBOLIC_MODELS_PATH"]
  export const SYMBOLIC_DB = process.env["SYMBOLIC_DB"]
  export const SYMBOLIC_DISABLE_CHANNEL_DB = truthy("SYMBOLIC_DISABLE_CHANNEL_DB")
  export const SYMBOLIC_SKIP_MIGRATIONS = truthy("SYMBOLIC_SKIP_MIGRATIONS")

  function number(key: string) {
    const value = process.env[key]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
}

// Dynamic getter for SYMBOLIC_DISABLE_PROJECT_CONFIG
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "SYMBOLIC_DISABLE_PROJECT_CONFIG", {
  get() {
    return truthy("SYMBOLIC_DISABLE_PROJECT_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for SYMBOLIC_TUI_CONFIG
// This must be evaluated at access time, not module load time,
// because tests and external tooling may set this env var at runtime
Object.defineProperty(Flag, "SYMBOLIC_TUI_CONFIG", {
  get() {
    return process.env["SYMBOLIC_TUI_CONFIG"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for SYMBOLIC_CONFIG_DIR
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "SYMBOLIC_CONFIG_DIR", {
  get() {
    return process.env["SYMBOLIC_CONFIG_DIR"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for SYMBOLIC_CLIENT
// This must be evaluated at access time, not module load time,
// because some commands override the client at runtime
Object.defineProperty(Flag, "SYMBOLIC_CLIENT", {
  get() {
    return process.env["SYMBOLIC_CLIENT"] ?? "cli"
  },
  enumerable: true,
  configurable: false,
})
