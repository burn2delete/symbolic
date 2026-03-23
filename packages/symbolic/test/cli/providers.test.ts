import { describe, expect, test } from "bun:test"

import { rank } from "../../src/cli/cmd/providers"

describe("provider ranking", () => {
  test("puts symbolic providers first and keeps alphabetical order within a rank", () => {
    const items = [
      { id: "openai", name: "OpenAI" },
      { id: "anthropic", name: "Anthropic" },
      { id: "symbolic", name: "Symbolic" },
      { id: "google", name: "Google" },
    ]

    expect(rank(items).map((x) => x.id)).toEqual(["symbolic", "openai", "google", "anthropic"])
  })

  test("falls back to name sorting for unknown providers", () => {
    const items = [
      { id: "zeta", name: "Zeta" },
      { id: "alpha", name: "Alpha" },
    ]

    expect(rank(items).map((x) => x.id)).toEqual(["alpha", "zeta"])
  })
})
