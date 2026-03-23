import { describe, expect, test } from "bun:test"
import { decodeDataUrl } from "../../src/util/data-url"

describe("decodeDataUrl", () => {
  test("decodes base64 payloads", () => {
    expect(decodeDataUrl("data:text/plain;base64,SGVsbG8gU3ltYm9saWM=")).toBe("Hello Symbolic")
  })

  test("decodes urlencoded payloads", () => {
    expect(decodeDataUrl("data:text/plain,Hello%20Symbolic")).toBe("Hello Symbolic")
  })
})
