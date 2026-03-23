import { describe, expect, test } from "bun:test"
import { isDenied } from "../../../src/cli/cmd/tui/util/denied"

describe("cli.tui.session denied", () => {
  test("matches question rejection errors", () => {
    expect(isDenied("QuestionRejectedError")).toBe(true)
    expect(isDenied("The user rejected permission to use this specific tool call.")).toBe(true)
    expect(isDenied("something else")).toBe(false)
  })
})
