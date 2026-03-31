import z from "zod"

import { SyncEvent } from "@/sync"
import { SessionTable } from "@/session/session.sql"
import { Database, eq } from "@/storage/db"

let modules:
  | Promise<
      [
        typeof import("../session/projectors"),
        typeof import("@/session"),
      ]
    >
  | undefined

export function initProjectors() {
  modules ??= Promise.all([import("../session/projectors"), import("@/session")])
  return modules.then(([projectors, session]) => {
    SyncEvent.init({
      projectors: projectors.createProjectors(session.Session),
      convertEvent: (type, data) => {
        if (type === "session.updated") {
          const id = (data as z.infer<typeof session.Session.Event.Updated.schema>).sessionID
          const row = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, id)).get())
          if (!row) return data

          return {
            sessionID: id,
            info: session.Session.fromRow(row),
          }
        }
        return data
      },
    })
  })
}
