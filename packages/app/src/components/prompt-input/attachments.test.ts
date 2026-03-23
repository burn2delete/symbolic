import { describe, expect, test } from "bun:test"
import { attachmentMime } from "./files"

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
