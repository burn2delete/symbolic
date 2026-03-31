import { Schema } from "effect"
import z from "zod"

import { Identifier } from "@/id/id"
import { withStatics } from "@/util/schema"

export const SessionID = Schema.String.pipe(
  Schema.brand("SessionID"),
  withStatics((schema) => ({
    make: (id: string) => schema.makeUnsafe(id),
    descending: (id?: string) => schema.makeUnsafe(Identifier.descending("session", id)),
    zod: Identifier.schema("session").pipe(z.custom<Schema.Schema.Type<typeof schema>>()),
  })),
)

export type SessionID = Schema.Schema.Type<typeof SessionID>

export const MessageID = Schema.String.pipe(
  Schema.brand("MessageID"),
  withStatics((schema) => ({
    make: (id: string) => schema.makeUnsafe(id),
    ascending: (id?: string) => schema.makeUnsafe(Identifier.ascending("message", id)),
    zod: Identifier.schema("message").pipe(z.custom<Schema.Schema.Type<typeof schema>>()),
  })),
)

export type MessageID = Schema.Schema.Type<typeof MessageID>

export const PartID = Schema.String.pipe(
  Schema.brand("PartID"),
  withStatics((schema) => ({
    make: (id: string) => schema.makeUnsafe(id),
    ascending: (id?: string) => schema.makeUnsafe(Identifier.ascending("part", id)),
    zod: Identifier.schema("part").pipe(z.custom<Schema.Schema.Type<typeof schema>>()),
  })),
)

export type PartID = Schema.Schema.Type<typeof PartID>
