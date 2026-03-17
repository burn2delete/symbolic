export * from "./client.js"
export * from "./server.js"

import { createSymbolicClient } from "./client.js"
import { createSymbolicServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export async function createSymbolic(options?: ServerOptions) {
  const server = await createSymbolicServer({
    ...options,
  })

  const client = createSymbolicClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
