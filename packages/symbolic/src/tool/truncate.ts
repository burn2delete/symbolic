import { TruncateEffect } from "./truncate-effect"
import { lazy } from "../util/lazy"

export namespace Truncate {
  export const MAX_LINES = TruncateEffect.MAX_LINES
  export const MAX_BYTES = TruncateEffect.MAX_BYTES
  export const DIR = TruncateEffect.DIR
  export const GLOB = TruncateEffect.GLOB

  export type Result = TruncateEffect.Result
  export type Options = TruncateEffect.Options

  const boot = lazy(() => TruncateEffect.cleanup())

  export async function init() {
    return boot()
  }

  export async function cleanup() {
    return TruncateEffect.cleanup()
  }

  export async function output(text: string, options: Options = {}, agent?: import("../agent/agent").Agent.Info) {
    return TruncateEffect.output(text, options, agent)
  }
}
