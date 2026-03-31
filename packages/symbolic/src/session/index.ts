import { Slug } from "@symbolic-agent/util/slug"
import path from "path"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Decimal } from "decimal.js"
import z from "zod"
import { type ProviderMetadata } from "ai"
import { Config } from "../config/config"
import { Flag } from "../flag/flag"
import { Installation } from "../installation"

import { Database, NotFoundError, eq, and, gte, isNull, desc, like, inArray, lt } from "../storage/db"
import type { SQL } from "../storage/db"
import { SyncEvent } from "@/sync"
import { SessionTable } from "./session.sql"
import { ProjectTable } from "../project/project.sql"
import { Storage } from "@/storage/storage"
import { Log } from "../util/log"
import { MessageV2 } from "./message-v2"
import { Instance } from "../project/instance"
import { SessionPrompt } from "./prompt"
import { fn } from "@/util/fn"
import { Command } from "../command"
import { Snapshot } from "@/snapshot/service"
import { WorkspaceContext } from "../control-plane/workspace-context"
import { ProjectID } from "../project/schema"
import { WorkspaceID } from "../control-plane/schema"
import { SessionID, MessageID, PartID } from "./schema"
import { updateSchema } from "../util/update-schema"

import type { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import { Permission as PermissionNext } from "@/permission/service"
import { Global } from "@/global"
import type { LanguageModelV2Usage } from "@ai-sdk/provider"
import { Effect, Layer, ServiceMap } from "effect"
import { makeRunPromise } from "@/effect/run-service"

export namespace Session {
  const log = Log.create({ service: "session" })

  const parentTitlePrefix = "New session - "
  const childTitlePrefix = "Child session - "

  function createDefaultTitle(isChild = false) {
    return (isChild ? childTitlePrefix : parentTitlePrefix) + new Date().toISOString()
  }

  export function isDefaultTitle(title: string) {
    return new RegExp(
      `^(${parentTitlePrefix}|${childTitlePrefix})\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$`,
    ).test(title)
  }

  type SessionRow = typeof SessionTable.$inferSelect

  export function fromRow(row: SessionRow): Info {
    const summary =
      row.summary_additions !== null ||
      row.summary_deletions !== null ||
      row.summary_files !== null ||
      row.summary_diffs !== null
        ? {
            additions: row.summary_additions ?? 0,
            deletions: row.summary_deletions ?? 0,
            files: row.summary_files ?? 0,
            diffs: row.summary_diffs ?? undefined,
          }
        : undefined
    const share = row.share_url ? { url: row.share_url } : undefined
    const revert = row.revert ?? undefined
    return {
      id: row.id,
      slug: row.slug,
      projectID: row.project_id,
      workspaceID: row.workspace_id ?? undefined,
      directory: row.directory,
      parentID: row.parent_id ?? undefined,
      title: row.title,
      version: row.version,
      summary,
      share,
      revert,
      permission: row.permission ?? undefined,
      time: {
        created: row.time_created,
        updated: row.time_updated,
        compacting: row.time_compacting ?? undefined,
        archived: row.time_archived ?? undefined,
      },
    }
  }

  export function toRow(info: Info) {
    return {
      id: info.id,
      project_id: info.projectID,
      workspace_id: info.workspaceID,
      parent_id: info.parentID,
      slug: info.slug,
      directory: info.directory,
      title: info.title,
      version: info.version,
      share_url: info.share?.url,
      summary_additions: info.summary?.additions,
      summary_deletions: info.summary?.deletions,
      summary_files: info.summary?.files,
      summary_diffs: info.summary?.diffs,
      revert: info.revert ?? null,
      permission: info.permission,
      time_created: info.time.created,
      time_updated: info.time.updated,
      time_compacting: info.time.compacting,
      time_archived: info.time.archived,
    }
  }

  function getForkedTitle(title: string): string {
    const match = title.match(/^(.+) \(fork #(\d+)\)$/)
    if (match) {
      const base = match[1]
      const num = parseInt(match[2], 10)
      return `${base} (fork #${num + 1})`
    }
    return `${title} (fork #1)`
  }

  export const Info = z
    .object({
      id: SessionID.zod,
      slug: z.string(),
      projectID: ProjectID.zod,
      workspaceID: WorkspaceID.zod.optional(),
      directory: z.string(),
      parentID: SessionID.zod.optional(),
      summary: z
        .object({
          additions: z.number(),
          deletions: z.number(),
          files: z.number(),
          diffs: Snapshot.FileDiff.array().optional(),
        })
        .optional(),
      share: z
        .object({
          url: z.string(),
        })
        .optional(),
      title: z.string(),
      version: z.string(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
        compacting: z.number().optional(),
        archived: z.number().optional(),
      }),
      permission: PermissionNext.Ruleset.optional(),
      revert: z
        .object({
          messageID: MessageID.zod,
          partID: PartID.zod.optional(),
          snapshot: z.string().optional(),
          diff: z.string().optional(),
        })
        .optional(),
    })
    .meta({
      ref: "Session",
    })
  export type Info = z.output<typeof Info>

  export const ProjectInfo = z
    .object({
      id: ProjectID.zod,
      name: z.string().optional(),
      worktree: z.string(),
    })
    .meta({
      ref: "ProjectSummary",
    })
  export type ProjectInfo = z.output<typeof ProjectInfo>

  export const GlobalInfo = Info.extend({
    project: ProjectInfo.nullable(),
  }).meta({
    ref: "GlobalSession",
  })
  export type GlobalInfo = z.output<typeof GlobalInfo>

  export async function ensureProjectors() {
    return import("../server/projectors").then(({ initProjectors }) => {
      return initProjectors()
    })
  }

  export async function sync<Def extends SyncEvent.Definition>(def: Def, data: SyncEvent.Event<Def>["data"]) {
    await ensureProjectors()
    SyncEvent.run(def, data)
  }

  export const Event = {
    Created: SyncEvent.define({
      type: "session.created",
      version: 1,
      aggregate: "sessionID",
      schema: z.object({
        sessionID: SessionID.zod,
        info: Info,
      }),
    }),
    Updated: SyncEvent.define({
      type: "session.updated",
      version: 1,
      aggregate: "sessionID",
      schema: z.object({
        sessionID: SessionID.zod,
        info: updateSchema(Info).extend({
          share: updateSchema(Info.shape.share.unwrap()).optional(),
          time: updateSchema(Info.shape.time).optional(),
        }),
      }),
      busSchema: z.object({
        sessionID: SessionID.zod,
        info: Info,
      }),
    }),
    Deleted: SyncEvent.define({
      type: "session.deleted",
      version: 1,
      aggregate: "sessionID",
      schema: z.object({
        sessionID: SessionID.zod,
        info: Info,
      }),
    }),
    Diff: BusEvent.define(
      "session.diff",
      z.object({
        sessionID: SessionID.zod,
        diff: Snapshot.FileDiff.array(),
      }),
    ),
    Error: BusEvent.define(
      "session.error",
      z.object({
        sessionID: SessionID.zod.optional(),
        error: MessageV2.Assistant.shape.error,
      }),
    ),
  }

  export const create = fn(
    z
      .object({
        parentID: SessionID.zod.optional(),
        title: z.string().optional(),
        permission: Info.shape.permission,
        workspaceID: WorkspaceID.zod.optional(),
      })
      .optional(),
    async (input) => {
      return createNext({
        parentID: input?.parentID,
        directory: Instance.directory,
        title: input?.title,
        permission: input?.permission,
        workspaceID: input?.workspaceID,
      })
    },
  )

  export const fork = fn(
    z.object({
      sessionID: SessionID.zod,
      messageID: MessageID.zod.optional(),
    }),
    async (input) => {
      const original = await get(input.sessionID)
      if (!original) throw new Error("session not found")
      const title = getForkedTitle(original.title)
      const session = await createNext({
        directory: Instance.directory,
        workspaceID: original.workspaceID,
        title,
      })
      const msgs = await messages({ sessionID: input.sessionID })
      const idMap = new Map<string, MessageID>()

      for (const msg of msgs) {
        if (input.messageID && msg.info.id >= input.messageID) break
        const newID = MessageID.ascending()
        idMap.set(msg.info.id, newID)

        const parentID = msg.info.role === "assistant" && msg.info.parentID ? idMap.get(msg.info.parentID) : undefined
        const cloned = await updateMessage({
          ...msg.info,
          sessionID: session.id,
          id: newID,
          ...(parentID && { parentID }),
        })

        for (const part of msg.parts) {
          await updatePart({
            ...part,
            id: PartID.ascending(),
            messageID: cloned.id,
            sessionID: session.id,
          })
        }
      }
      return session
    },
  )

  export const touch = fn(SessionID.zod, async (sessionID) => {
    const time = Date.now()
    await sync(Event.Updated, { sessionID, info: { time: { updated: time } } })
  })

  export async function createNext(input: {
    id?: SessionID
    title?: string
    parentID?: SessionID
    workspaceID?: WorkspaceID
    directory: string
    permission?: PermissionNext.Ruleset
  }) {
    const result: Info = {
      id: SessionID.descending(input.id),
      slug: Slug.create(),
      version: Installation.VERSION,
      projectID: Instance.project.id,
      directory: input.directory,
      workspaceID: input.workspaceID,
      parentID: input.parentID,
      title: input.title ?? createDefaultTitle(!!input.parentID),
      permission: input.permission,
      time: {
        created: Date.now(),
        updated: Date.now(),
      },
    }
    log.info("created", result)
    await sync(Event.Created, { sessionID: result.id, info: result })
    const cfg = await Config.get()
    if (!result.parentID && (Flag.SYMBOLIC_AUTO_SHARE || cfg.share === "auto"))
      share(result.id).catch(() => {
        // Silently ignore sharing errors during session creation
      })
    if (!Flag.SYMBOLIC_EXPERIMENTAL_WORKSPACES) {
      Bus.publish(Event.Updated, {
        sessionID: result.id,
        info: result,
      })
    }
    return result
  }

  export function plan(input: { slug: string; time: { created: number } }) {
    const base = Instance.project.vcs
      ? path.join(Instance.worktree, ".symbolic", "plans")
      : path.join(Global.Path.data, "plans")
    return path.join(base, [input.time.created, input.slug].join("-") + ".md")
  }

  export const get = fn(SessionID.zod, async (id) => {
    const row = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, id)).get())
    if (!row) throw new NotFoundError({ message: `Session not found: ${id}` })
    return fromRow(row)
  })

  export const share = fn(SessionID.zod, async (id) => {
    const cfg = await Config.get()
    if (cfg.share === "disabled") {
      throw new Error("Sharing is disabled in configuration")
    }
    const { ShareNext } = await import("@/share/share-next")
    const share = await ShareNext.create(id)
    await sync(Event.Updated, { sessionID: id, info: { share: { url: share.url } } })
    return share
  })

  export const unshare = fn(SessionID.zod, async (id) => {
    // Use ShareNext to remove the share (same as share function uses ShareNext to create)
    const { ShareNext } = await import("@/share/share-next")
    await ShareNext.remove(id)
    await sync(Event.Updated, { sessionID: id, info: { share: { url: null } } })
  })

  export const setTitle = fn(
    z.object({
      sessionID: SessionID.zod,
      title: z.string(),
    }),
    async (input) => {
      await sync(Event.Updated, { sessionID: input.sessionID, info: { title: input.title } })
      return get(input.sessionID)
    },
  )

  export const setArchived = fn(
    z.object({
      sessionID: SessionID.zod,
      time: z.number().optional(),
    }),
    async (input) => {
      await sync(Event.Updated, { sessionID: input.sessionID, info: { time: { archived: input.time } } })
      return get(input.sessionID)
    },
  )

  export const setPermission = fn(
    z.object({
      sessionID: SessionID.zod,
      permission: PermissionNext.Ruleset,
    }),
    async (input) => {
      await sync(Event.Updated, {
        sessionID: input.sessionID,
        info: { permission: input.permission, time: { updated: Date.now() } },
      })
      return get(input.sessionID)
    },
  )

  export const setRevert = fn(
    z.object({
      sessionID: SessionID.zod,
      revert: Info.shape.revert,
      summary: Info.shape.summary,
    }),
    async (input) => {
      await sync(Event.Updated, {
        sessionID: input.sessionID,
        info: {
          summary: input.summary,
          time: { updated: Date.now() },
          revert: input.revert,
        },
      })
      return get(input.sessionID)
    },
  )

  export const clearRevert = fn(SessionID.zod, async (sessionID) => {
    await sync(Event.Updated, {
      sessionID,
      info: {
        time: { updated: Date.now() },
        revert: null,
      },
    })
    return get(sessionID)
  })

  export const setSummary = fn(
    z.object({
      sessionID: SessionID.zod,
      summary: Info.shape.summary,
    }),
    async (input) => {
      await sync(Event.Updated, {
        sessionID: input.sessionID,
        info: {
          time: { updated: Date.now() },
          summary: input.summary,
        },
      })
      return get(input.sessionID)
    },
  )

  export const diff = fn(SessionID.zod, async (sessionID) => {
    try {
      const diffs = await Storage.read<Snapshot.FileDiff[]>(["session_diff", sessionID])
      if (diffs.length > 0) return diffs
    } catch {
    }

    const session = await get(sessionID).catch(() => undefined)
    return session?.summary?.diffs ?? []
  })

  export const messages = fn(
    z.object({
      sessionID: SessionID.zod,
      limit: z.number().optional(),
    }),
    async (input) => {
      const result = [] as MessageV2.WithParts[]
      for await (const msg of MessageV2.stream(input.sessionID)) {
        if (input.limit && result.length >= input.limit) break
        result.push(msg)
      }
      result.reverse()
      return result
    },
  )

  export function* list(input?: {
    directory?: string
    workspaceID?: WorkspaceID
    roots?: boolean
    start?: number
    search?: string
    limit?: number
  }) {
    const project = Instance.project
    const conditions = [eq(SessionTable.project_id, project.id)]

    if (WorkspaceContext.workspaceID) {
      conditions.push(eq(SessionTable.workspace_id, WorkspaceContext.workspaceID))
    }
    if (input?.directory) {
      conditions.push(eq(SessionTable.directory, input.directory))
    }
    if (input?.roots) {
      conditions.push(isNull(SessionTable.parent_id))
    }
    if (input?.start) {
      conditions.push(gte(SessionTable.time_updated, input.start))
    }
    if (input?.search) {
      conditions.push(like(SessionTable.title, `%${input.search}%`))
    }

    const limit = input?.limit ?? 100

    const rows = Database.use((db) =>
      db
        .select()
        .from(SessionTable)
        .where(and(...conditions))
        .orderBy(desc(SessionTable.time_updated))
        .limit(limit)
        .all(),
    )
    for (const row of rows) {
      yield fromRow(row)
    }
  }

  export function* listGlobal(input?: {
    directory?: string
    roots?: boolean
    start?: number
    cursor?: number
    search?: string
    limit?: number
    archived?: boolean
  }) {
    const conditions: SQL[] = []

    if (input?.directory) {
      conditions.push(eq(SessionTable.directory, input.directory))
    }
    if (input?.roots) {
      conditions.push(isNull(SessionTable.parent_id))
    }
    if (input?.start) {
      conditions.push(gte(SessionTable.time_updated, input.start))
    }
    if (input?.cursor) {
      conditions.push(lt(SessionTable.time_updated, input.cursor))
    }
    if (input?.search) {
      conditions.push(like(SessionTable.title, `%${input.search}%`))
    }
    if (!input?.archived) {
      conditions.push(isNull(SessionTable.time_archived))
    }

    const limit = input?.limit ?? 100

    const rows = Database.use((db) => {
      const query =
        conditions.length > 0
          ? db
              .select()
              .from(SessionTable)
              .where(and(...conditions))
          : db.select().from(SessionTable)
      return query.orderBy(desc(SessionTable.time_updated), desc(SessionTable.id)).limit(limit).all()
    })

    const ids = [...new Set(rows.map((row) => row.project_id))]
    const projects = new Map<string, ProjectInfo>()

    if (ids.length > 0) {
      const items = Database.use((db) =>
        db
          .select({ id: ProjectTable.id, name: ProjectTable.name, worktree: ProjectTable.worktree })
          .from(ProjectTable)
          .where(inArray(ProjectTable.id, ids))
          .all(),
      )
      for (const item of items) {
        projects.set(item.id, {
          id: item.id,
          name: item.name ?? undefined,
          worktree: item.worktree,
        })
      }
    }

    for (const row of rows) {
      const project = projects.get(row.project_id) ?? null
      yield { ...fromRow(row), project }
    }
  }

  export const children = fn(SessionID.zod, async (parentID) => {
    const project = Instance.project
    const rows = Database.use((db) =>
      db
        .select()
        .from(SessionTable)
        .where(and(eq(SessionTable.project_id, project.id), eq(SessionTable.parent_id, parentID)))
        .all(),
    )
    return rows.map(fromRow)
  })

  export const remove = fn(SessionID.zod, async (sessionID) => {
    try {
      const session = await get(sessionID)
      for (const child of await children(sessionID)) {
        await remove(child.id)
      }
      await unshare(sessionID).catch(() => {})
      await sync(Event.Deleted, { sessionID, info: session })
      SyncEvent.remove(sessionID)
    } catch (e) {
      log.error(e)
    }
  })

  export const updateMessage = fn(MessageV2.Info, async (msg) => {
    await sync(MessageV2.Event.Updated, {
      sessionID: msg.sessionID,
      info: msg,
    })
    return msg
  })

  export const removeMessage = fn(
    z.object({
      sessionID: SessionID.zod,
      messageID: MessageID.zod,
    }),
    async (input) => {
      await sync(MessageV2.Event.Removed, {
        sessionID: input.sessionID,
        messageID: input.messageID,
      })
      return input.messageID
    },
  )

  export const removePart = fn(
    z.object({
      sessionID: SessionID.zod,
      messageID: MessageID.zod,
      partID: PartID.zod,
    }),
    async (input) => {
      await sync(MessageV2.Event.PartRemoved, {
        sessionID: input.sessionID,
        messageID: input.messageID,
        partID: input.partID,
      })
      return input.partID
    },
  )

  const UpdatePartInput = MessageV2.Part

  export const updatePart = fn(UpdatePartInput, async (part) => {
    await sync(MessageV2.Event.PartUpdated, {
      sessionID: part.sessionID,
      part: structuredClone(part),
      time: Date.now(),
    })
    return part
  })

  export const updatePartDelta = fn(
    z.object({
      sessionID: SessionID.zod,
      messageID: MessageID.zod,
      partID: PartID.zod,
      field: z.string(),
      delta: z.string(),
    }),
    async (input) => {
      Bus.publish(MessageV2.Event.PartDelta, input)
    },
  )

  export const getUsage = fn(
    z.object({
      model: z.custom<Provider.Model>(),
      usage: z.custom<LanguageModelV2Usage>(),
      metadata: z.custom<ProviderMetadata>().optional(),
    }),
    (input) => {
      const safe = (value: number) => {
        if (!Number.isFinite(value)) return 0
        return value
      }
      const inputTokens = safe(input.usage.inputTokens ?? 0)
      const outputTokens = safe(input.usage.outputTokens ?? 0)
      const reasoningTokens = safe(input.usage.reasoningTokens ?? 0)

      const cacheReadInputTokens = safe(input.usage.cachedInputTokens ?? 0)
      const cacheWriteInputTokens = safe(
        (input.metadata?.["anthropic"]?.["cacheCreationInputTokens"] ??
          // @ts-expect-error
          input.metadata?.["bedrock"]?.["usage"]?.["cacheWriteInputTokens"] ??
          // @ts-expect-error
          input.metadata?.["venice"]?.["usage"]?.["cacheCreationInputTokens"] ??
          0) as number,
      )

      // AI SDK v6 normalizes inputTokens to include cached tokens across providers.
      // Subtract cache usage once so input stays non-cached while total remains SDK-provided.
      const adjustedInputTokens = safe(inputTokens - cacheReadInputTokens - cacheWriteInputTokens)
      const total = input.usage.totalTokens

      const tokens = {
        total,
        input: adjustedInputTokens,
        output: outputTokens,
        reasoning: reasoningTokens,
        cache: {
          write: cacheWriteInputTokens,
          read: cacheReadInputTokens,
        },
      }

      const costInfo =
        input.model.cost?.experimentalOver200K && tokens.input + tokens.cache.read > 200_000
          ? input.model.cost.experimentalOver200K
          : input.model.cost
      return {
        cost: safe(
          new Decimal(0)
            .add(new Decimal(tokens.input).mul(costInfo?.input ?? 0).div(1_000_000))
            .add(new Decimal(tokens.output).mul(costInfo?.output ?? 0).div(1_000_000))
            .add(new Decimal(tokens.cache.read).mul(costInfo?.cache?.read ?? 0).div(1_000_000))
            .add(new Decimal(tokens.cache.write).mul(costInfo?.cache?.write ?? 0).div(1_000_000))
            // TODO: update models.dev to have better pricing model, for now:
            // charge reasoning tokens at the same rate as output tokens
            .add(new Decimal(tokens.reasoning).mul(costInfo?.output ?? 0).div(1_000_000))
            .toNumber(),
        ),
        tokens,
      }
    },
  )

  export class BusyError extends Error {
    constructor(public readonly sessionID: string) {
      super(`Session ${sessionID} is busy`)
    }
  }

  export const initialize = fn(
    z.object({
      sessionID: SessionID.zod,
      modelID: ModelID.zod,
      providerID: ProviderID.zod,
      messageID: MessageID.zod,
    }),
    async (input) => {
      await SessionPrompt.command({
        sessionID: input.sessionID,
        messageID: input.messageID,
        model: input.providerID + "/" + input.modelID,
        command: Command.Default.INIT,
        arguments: "",
      })
    },
  )

  export interface Interface {
    readonly create: (input: Parameters<typeof create>[0]) => Effect.Effect<Awaited<ReturnType<typeof create>>>
    readonly fork: (input: Parameters<typeof fork>[0]) => Effect.Effect<Awaited<ReturnType<typeof fork>>>
    readonly touch: (input: Parameters<typeof touch>[0]) => Effect.Effect<Awaited<ReturnType<typeof touch>>>
    readonly get: (input: Parameters<typeof get>[0]) => Effect.Effect<Awaited<ReturnType<typeof get>>>
    readonly share: (input: Parameters<typeof share>[0]) => Effect.Effect<Awaited<ReturnType<typeof share>>>
    readonly unshare: (input: Parameters<typeof unshare>[0]) => Effect.Effect<Awaited<ReturnType<typeof unshare>>>
    readonly setTitle: (input: Parameters<typeof setTitle>[0]) => Effect.Effect<Awaited<ReturnType<typeof setTitle>>>
    readonly setArchived: (input: Parameters<typeof setArchived>[0]) => Effect.Effect<Awaited<ReturnType<typeof setArchived>>>
    readonly setPermission: (input: Parameters<typeof setPermission>[0]) => Effect.Effect<Awaited<ReturnType<typeof setPermission>>>
    readonly setRevert: (input: Parameters<typeof setRevert>[0]) => Effect.Effect<Awaited<ReturnType<typeof setRevert>>>
    readonly clearRevert: (input: Parameters<typeof clearRevert>[0]) => Effect.Effect<Awaited<ReturnType<typeof clearRevert>>>
    readonly setSummary: (input: Parameters<typeof setSummary>[0]) => Effect.Effect<Awaited<ReturnType<typeof setSummary>>>
    readonly diff: (input: Parameters<typeof diff>[0]) => Effect.Effect<Awaited<ReturnType<typeof diff>>>
    readonly messages: (input: Parameters<typeof messages>[0]) => Effect.Effect<Awaited<ReturnType<typeof messages>>>
    readonly children: (input: Parameters<typeof children>[0]) => Effect.Effect<Awaited<ReturnType<typeof children>>>
    readonly remove: (input: Parameters<typeof remove>[0]) => Effect.Effect<Awaited<ReturnType<typeof remove>>>
    readonly updateMessage: (input: Parameters<typeof updateMessage>[0]) => Effect.Effect<Awaited<ReturnType<typeof updateMessage>>>
    readonly removeMessage: (input: Parameters<typeof removeMessage>[0]) => Effect.Effect<Awaited<ReturnType<typeof removeMessage>>>
    readonly removePart: (input: Parameters<typeof removePart>[0]) => Effect.Effect<Awaited<ReturnType<typeof removePart>>>
    readonly updatePart: (input: Parameters<typeof updatePart>[0]) => Effect.Effect<Awaited<ReturnType<typeof updatePart>>>
    readonly updatePartDelta: (input: Parameters<typeof updatePartDelta>[0]) => Effect.Effect<Awaited<ReturnType<typeof updatePartDelta>>>
    readonly getUsage: (input: Parameters<typeof getUsage>[0]) => Effect.Effect<Awaited<ReturnType<typeof getUsage>>>
    readonly initialize: (input: Parameters<typeof initialize>[0]) => Effect.Effect<Awaited<ReturnType<typeof initialize>>>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@symbolic-agent/Session") {}

  export const layer = Layer.succeed(
    Service,
    Service.of({
      create: Effect.fn("Session.create")(function* (input: Parameters<typeof create>[0]) {
        return yield* Effect.promise(() => create(input))
      }),
      fork: Effect.fn("Session.fork")(function* (input: Parameters<typeof fork>[0]) {
        return yield* Effect.promise(() => fork(input))
      }),
      touch: Effect.fn("Session.touch")(function* (input: Parameters<typeof touch>[0]) {
        return yield* Effect.promise(() => touch(input))
      }),
      get: Effect.fn("Session.get")(function* (input: Parameters<typeof get>[0]) {
        return yield* Effect.promise(() => get(input))
      }),
      share: Effect.fn("Session.share")(function* (input: Parameters<typeof share>[0]) {
        return yield* Effect.promise(() => share(input))
      }),
      unshare: Effect.fn("Session.unshare")(function* (input: Parameters<typeof unshare>[0]) {
        return yield* Effect.promise(() => unshare(input))
      }),
      setTitle: Effect.fn("Session.setTitle")(function* (input: Parameters<typeof setTitle>[0]) {
        return yield* Effect.promise(() => setTitle(input))
      }),
      setArchived: Effect.fn("Session.setArchived")(function* (input: Parameters<typeof setArchived>[0]) {
        return yield* Effect.promise(() => setArchived(input))
      }),
      setPermission: Effect.fn("Session.setPermission")(function* (input: Parameters<typeof setPermission>[0]) {
        return yield* Effect.promise(() => setPermission(input))
      }),
      setRevert: Effect.fn("Session.setRevert")(function* (input: Parameters<typeof setRevert>[0]) {
        return yield* Effect.promise(() => setRevert(input))
      }),
      clearRevert: Effect.fn("Session.clearRevert")(function* (input: Parameters<typeof clearRevert>[0]) {
        return yield* Effect.promise(() => clearRevert(input))
      }),
      setSummary: Effect.fn("Session.setSummary")(function* (input: Parameters<typeof setSummary>[0]) {
        return yield* Effect.promise(() => setSummary(input))
      }),
      diff: Effect.fn("Session.diff")(function* (input: Parameters<typeof diff>[0]) {
        return yield* Effect.promise(() => diff(input))
      }),
      messages: Effect.fn("Session.messages")(function* (input: Parameters<typeof messages>[0]) {
        return yield* Effect.promise(() => messages(input))
      }),
      children: Effect.fn("Session.children")(function* (input: Parameters<typeof children>[0]) {
        return yield* Effect.promise(() => children(input))
      }),
      remove: Effect.fn("Session.remove")(function* (input: Parameters<typeof remove>[0]) {
        return yield* Effect.promise(() => remove(input))
      }),
      updateMessage: Effect.fn("Session.updateMessage")(function* (input: Parameters<typeof updateMessage>[0]) {
        return yield* Effect.promise(() => updateMessage(input))
      }),
      removeMessage: Effect.fn("Session.removeMessage")(function* (input: Parameters<typeof removeMessage>[0]) {
        return yield* Effect.promise(() => removeMessage(input))
      }),
      removePart: Effect.fn("Session.removePart")(function* (input: Parameters<typeof removePart>[0]) {
        return yield* Effect.promise(() => removePart(input))
      }),
      updatePart: Effect.fn("Session.updatePart")(function* (input: Parameters<typeof updatePart>[0]) {
        return yield* Effect.promise(() => updatePart(input))
      }),
      updatePartDelta: Effect.fn("Session.updatePartDelta")(function* (input: Parameters<typeof updatePartDelta>[0]) {
        return yield* Effect.promise(() => updatePartDelta(input))
      }),
      getUsage: Effect.fn("Session.getUsage")(function* (input: Parameters<typeof getUsage>[0]) {
        return yield* Effect.succeed(getUsage.force(input))
      }),
      initialize: Effect.fn("Session.initialize")(function* (input: Parameters<typeof initialize>[0]) {
        return yield* Effect.promise(() => initialize(input))
      }),
    }),
  )

  const runPromise = makeRunPromise(Service, layer)
}
