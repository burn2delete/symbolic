import { NamedError } from "@symbolic-agent/util/error"
import type { Context } from "hono"
import { HTTPException } from "hono/http-exception"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { Provider } from "../provider/provider"
import { Session } from "../session"
import { NotFoundError } from "../storage/db"
import { Log } from "../util/log"

export function errorHandler(log: ReturnType<typeof Log.create>) {
  return (err: Error, c: Context) => {
    log.error("failed", {
      error: err,
    })
    if (err instanceof NamedError) {
      let status: ContentfulStatusCode
      if (err instanceof NotFoundError) status = 404
      else if (err instanceof Provider.ModelNotFoundError) status = 400
      else if (err.name === "ProviderAuthValidationFailed") status = 400
      else if (err.name.startsWith("Worktree")) status = 400
      else status = 500
      return c.json(err.toObject(), { status })
    }
    if (err instanceof Session.BusyError) {
      return c.json(new NamedError.Unknown({ message: err.message }).toObject(), { status: 400 })
    }
    if (err instanceof HTTPException) return err.getResponse()
    const message = err instanceof Error && err.stack ? err.stack : err.toString()
    return c.json(new NamedError.Unknown({ message }).toObject(), {
      status: 500,
    })
  }
}
