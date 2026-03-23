import { PartID } from "@/session/schema"
import type { PromptInfo } from "./history"

type Item = PromptInfo["parts"][number]
type Saved = {
  id: string
  messageID: string
  sessionID: string
}

export function strip<T extends Item & Saved>(part: T): Omit<T, keyof Saved> {
  const { id: _id, messageID: _messageID, sessionID: _sessionID, ...rest } = part
  return rest
}

export function assign<T extends Item>(part: T): T & { id: PartID } {
  return {
    ...part,
    id: PartID.ascending(),
  }
}
