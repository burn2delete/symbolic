import { EventEmitter } from "events"
import z from "zod"
import type { ZodObject } from "zod"

import { Bus as ProjectBus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Flag } from "@/flag/flag"
import { Database, eq } from "@/storage/db"
import { EventSequenceTable, EventTable } from "./event.sql"
import { EventID } from "./schema"

export namespace SyncEvent {
  export type Definition = {
    type: string
    version: number
    aggregate: string
    schema: z.ZodObject
    properties: z.ZodObject
  }

  export type Event<Def extends Definition = Definition> = {
    id: string
    seq: number
    aggregateID: string
    data: z.infer<Def["schema"]>
  }

  export type SerializedEvent<Def extends Definition = Definition> = Event<Def> & { type: string }

  type ProjectorFunc = (db: Database.TxOrDb, data: unknown) => void

  export const registry = new Map<string, Definition>()
  let projectors: Map<Definition, ProjectorFunc> | undefined
  const versions = new Map<string, number>()
  let frozen = false
  let convertEvent: (type: string, event: Event["data"]) => Promise<Record<string, unknown>> | Record<string, unknown>

  const Bus = new EventEmitter<{ event: [{ def: Definition; event: Event }] }>()

  export function reset() {
    frozen = false
    projectors = undefined
    convertEvent = (_, data) => data
  }

  export function init(input: { projectors: Array<[Definition, ProjectorFunc]>; convertEvent?: typeof convertEvent }) {
    projectors = new Map(input.projectors)

    for (const [type, version] of versions.entries()) {
      const def = registry.get(versionedType(type, version))!
      BusEvent.define(def.type, def.properties || def.schema)
    }

    frozen = true
    convertEvent = input.convertEvent || ((_, data) => data)
  }

  export function versionedType<A extends string>(type: A): A
  export function versionedType<A extends string, B extends number>(type: A, version: B): `${A}.${B}`
  export function versionedType(type: string, version?: number) {
    return version ? `${type}.${version}` : type
  }

  export function define<
    Type extends string,
    Agg extends string,
    Schema extends ZodObject<Record<Agg, z.ZodType<string>>>,
    BusSchema extends ZodObject = Schema,
  >(input: { type: Type; version: number; aggregate: Agg; schema: Schema; busSchema?: BusSchema }) {
    if (frozen) throw new Error("Error defining sync event: sync system has been frozen")

    const def = {
      type: input.type,
      version: input.version,
      aggregate: input.aggregate,
      schema: input.schema,
      properties: input.busSchema ? input.busSchema : input.schema,
    }

    versions.set(def.type, Math.max(def.version, versions.get(def.type) || 0))
    registry.set(versionedType(def.type, def.version), def)

    return def
  }

  export function project<Def extends Definition>(
    def: Def,
    func: (db: Database.TxOrDb, data: Event<Def>["data"]) => void,
  ): [Definition, ProjectorFunc] {
    return [def, func as ProjectorFunc]
  }

  function process<Def extends Definition>(def: Def, event: Event<Def>, options: { publish: boolean }) {
    if (projectors == null) throw new Error("No projectors available. Call `SyncEvent.init` to install projectors")

    const projector = projectors.get(def)
    if (!projector) throw new Error(`Projector not found for event: ${def.type}`)

    Database.transaction((tx) => {
      projector(tx, event.data)

      if (Flag.SYMBOLIC_EXPERIMENTAL_WORKSPACES) {
        tx.insert(EventSequenceTable)
          .values({ aggregate_id: event.aggregateID, seq: event.seq })
          .onConflictDoUpdate({ target: EventSequenceTable.aggregate_id, set: { seq: event.seq } })
          .run()
        tx.insert(EventTable)
          .values({
            id: event.id,
            seq: event.seq,
            aggregate_id: event.aggregateID,
            type: versionedType(def.type, def.version),
            data: event.data as Record<string, unknown>,
          })
          .run()
      }

      Database.effect(() => {
        Bus.emit("event", { def, event })

        if (!options.publish) return
        const result = convertEvent(def.type, event.data)
        if (result instanceof Promise) {
          result.then((data) => {
            ProjectBus.publish({ type: def.type, properties: def.schema }, data)
          })
          return
        }
        ProjectBus.publish({ type: def.type, properties: def.schema }, result)
      })
    }, { behavior: "immediate" })
  }

  export function replay(event: SerializedEvent, options?: { republish: boolean }) {
    const def = registry.get(event.type)
    if (!def) throw new Error(`Unknown event type: ${event.type}`)

    const row = Database.use((db) =>
      db.select({ seq: EventSequenceTable.seq }).from(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, event.aggregateID)).get(),
    )

    const latest = row?.seq ?? -1
    if (event.seq <= latest) return

    const expected = latest + 1
    if (event.seq !== expected) {
      throw new Error(`Sequence mismatch for aggregate "${event.aggregateID}": expected ${expected}, got ${event.seq}`)
    }

    process(def, event, { publish: !!options?.republish })
  }

  export function run<Def extends Definition>(def: Def, data: Event<Def>["data"]) {
    const agg = (data as Record<string, string>)[def.aggregate]
    if (agg == null) {
      throw new Error(`SyncEvent.run: "${def.aggregate}" required but not found: ${JSON.stringify(data)}`)
    }

    if (def.version !== versions.get(def.type)) {
      throw new Error(`SyncEvent.run: running old versions of events is not allowed: ${def.type}`)
    }

    Database.transaction(
      (tx) => {
        const id = EventID.ascending()
        const row = tx.select({ seq: EventSequenceTable.seq }).from(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, agg)).get()
        const seq = row?.seq != null ? row.seq + 1 : 0

        const event = { id, seq, aggregateID: agg, data }
        process(def, event, { publish: true })
      },
      {
        behavior: "immediate",
      },
    )
  }

  export function remove(aggregateID: string) {
    Database.transaction((tx) => {
      tx.delete(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, aggregateID)).run()
      tx.delete(EventTable).where(eq(EventTable.aggregate_id, aggregateID)).run()
    })
  }

  export function subscribeAll(handler: (event: { def: Definition; event: Event }) => void) {
    Bus.on("event", handler)
    return () => Bus.off("event", handler)
  }

  export function payloads() {
    return z
      .union(
        registry
          .entries()
          .map(([type, def]) =>
            z
              .object({
                type: z.literal(type),
                aggregate: z.literal(def.aggregate),
                data: def.schema,
              })
              .meta({
                ref: "SyncEvent" + "." + def.type,
              }),
          )
          .toArray() as any,
      )
      .meta({
        ref: "SyncEvent",
      })
  }
}
