import { describe, expect, test } from "bun:test"
import { attachmentMime } from "./files"
import { pasteMode } from "./paste"

describe("attachmentMime", () => {
  test("recognizes text attachments", async () => {
    const file = new File(["hello"], "note.txt", { type: "text/plain" })
    await expect(attachmentMime(file)).resolves.toBe("text/plain")
  })

  test("keeps image and pdf types distinct", async () => {
    await expect(attachmentMime(new File(["x"], "photo.png", { type: "image/png" }))).resolves.toBe("image/png")
    await expect(attachmentMime(new File(["x"], "report.pdf", { type: "application/pdf" }))).resolves.toBe(
      "application/pdf",
    )
  })
})

describe("pasteMode", () => {
  test("uses native paste for short single-line text", () => {
    expect(pasteMode("hello world")).toBe("native")
  })

  test("uses manual paste for multiline text", () => {
    expect(
      pasteMode(`{
  "ok": true
}`),
    ).toBe("manual")
    expect(pasteMode("a\r\nb")).toBe("manual")
  })

  test("uses manual paste for large text", () => {
    expect(pasteMode("x".repeat(8000))).toBe("manual")
  })
})
