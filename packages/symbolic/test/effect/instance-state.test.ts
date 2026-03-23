import { afterEach, expect, test } from "bun:test"
import { setTimeout as sleep } from "node:timers/promises"
import { Effect, Layer, ManagedRuntime, ServiceMap } from "effect"
import { InstanceState } from "../../src/effect/instance-state"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

async function access<A, E>(state: InstanceState<A, E>, dir: string) {
  return Instance.provide({
    directory: dir,
    fn: () => Effect.runPromise(InstanceState.get(state)),
  })
}

afterEach(async () => {
  await Instance.disposeAll()
})

test("InstanceState caches values per directory", async () => {
  await using tmp = await tmpdir()
  let n = 0

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const state = yield* InstanceState.make(() => Effect.sync(() => ({ n: ++n })))

        const a = yield* Effect.promise(() => access(state, tmp.path))
        const b = yield* Effect.promise(() => access(state, tmp.path))

        expect(a).toBe(b)
        expect(n).toBe(1)
      }),
    ),
  )
})

test("InstanceState isolates directories", async () => {
  await using one = await tmpdir()
  await using two = await tmpdir()
  let n = 0

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const state = yield* InstanceState.make((ctx) => Effect.sync(() => ({ dir: ctx.directory, n: ++n })))

        const a = yield* Effect.promise(() => access(state, one.path))
        const b = yield* Effect.promise(() => access(state, two.path))
        const c = yield* Effect.promise(() => access(state, one.path))

        expect(a).toBe(c)
        expect(a).not.toBe(b)
        expect(n).toBe(2)
      }),
    ),
  )
})

test("InstanceState invalidates on reload", async () => {
  await using tmp = await tmpdir()
  const seen: string[] = []
  let n = 0

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const state = yield* InstanceState.make(() =>
          Effect.acquireRelease(
            Effect.sync(() => ({ n: ++n })),
            (value) =>
              Effect.sync(() => {
                seen.push(String(value.n))
              }),
          ),
        )

        const a = yield* Effect.promise(() => access(state, tmp.path))
        yield* Effect.promise(() => Instance.reload({ directory: tmp.path }))
        const b = yield* Effect.promise(() => access(state, tmp.path))

        expect(a).not.toBe(b)
        expect(seen).toEqual(["1"])
      }),
    ),
  )
})

test("InstanceState preserves directory across concurrent async access", async () => {
  await using one = await tmpdir({ git: true })
  await using two = await tmpdir({ git: true })
  await using three = await tmpdir({ git: true })

  interface Api {
    readonly get: () => Effect.Effect<{ directory: string; worktree: string; project: string }>
  }

  class Test extends ServiceMap.Service<Test, Api>()("@test/InstanceStateAsync") {
    static readonly layer = Layer.effect(
      Test,
      Effect.gen(function* () {
        const state = yield* InstanceState.make((ctx) =>
          Effect.sync(() => ({
            directory: ctx.directory,
            worktree: ctx.worktree,
            project: ctx.project.id,
          })),
        )

        return Test.of({
          get: Effect.fn("Test.get")(function* () {
            yield* Effect.promise(() => sleep(1))
            yield* Effect.yieldNow
            yield* Effect.promise(() => Promise.resolve())
            yield* Effect.promise(() => sleep(1))
            return yield* InstanceState.get(state)
          }),
        })
      }),
    )
  }

  const rt = ManagedRuntime.make(Test.layer)

  try {
    const [a, b, c] = await Promise.all([
      Instance.provide({
        directory: one.path,
        fn: () => rt.runPromise(Test.use((svc) => svc.get())),
      }),
      Instance.provide({
        directory: two.path,
        fn: () => rt.runPromise(Test.use((svc) => svc.get())),
      }),
      Instance.provide({
        directory: three.path,
        fn: () => rt.runPromise(Test.use((svc) => svc.get())),
      }),
    ])

    expect(a.directory).toBe(one.path)
    expect(b.directory).toBe(two.path)
    expect(c.directory).toBe(three.path)
    expect(a.worktree).toBe(one.path)
    expect(b.worktree).toBe(two.path)
    expect(c.worktree).toBe(three.path)
    expect(a.project).not.toBe(b.project)
    expect(a.project).not.toBe(c.project)
    expect(b.project).not.toBe(c.project)
  } finally {
    await rt.dispose()
  }
})
