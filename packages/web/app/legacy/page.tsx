import Link from "next/link"

export default function Page() {
  const rows = [
    {
      name: "Package",
      body: "The old Astro-based surface now lives in packages/web-legacy.",
    },
    {
      name: "Deploy",
      body: "SST no longer deploys the legacy docs host by default.",
    },
    {
      name: "Automation",
      body: "Docs update and locale sync workflows stay disabled until this new package has a clear replacement scope.",
    },
  ]

  return (
    <main className="px-5 pb-8 pt-8 sm:px-8 lg:px-10 lg:pt-10">
      <div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="panel rise rounded-[2rem] p-6 sm:p-8">
          <p className="font-mono text-xs tracking-[0.24em] text-brand uppercase">Legacy handoff</p>
          <h1 className="mt-4 text-4xl font-medium text-balance sm:text-5xl">
            The old web package is deprecated on purpose.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-mute">
            The fork now has a clean `packages/web` package for new work. `packages/web-legacy` remains as a reference
            point for docs and share behavior that may or may not come back.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              className="inline-flex items-center justify-center rounded-full bg-ink px-5 py-3 text-sm font-medium text-paper transition hover:bg-brand"
              href="/"
            >
              Back to the new shell
            </Link>
            <a
              className="inline-flex items-center justify-center rounded-full border border-line bg-white/70 px-5 py-3 text-sm font-medium text-ink transition hover:border-brand hover:text-brand"
              href="https://github.com/SymbolicOS/symbolic/tree/dev/packages/web-legacy"
              target="_blank"
              rel="noreferrer"
            >
              Browse web-legacy
            </a>
          </div>
        </section>

        <section className="grid gap-4">
          {rows.map((row, i) => (
            <article
              key={row.name}
              className="panel rise rounded-[1.75rem] p-5 sm:p-6"
              style={{ animationDelay: `${i * 100}ms` }}
            >
              <p className="font-mono text-xs tracking-[0.24em] text-brand uppercase">{row.name}</p>
              <p className="mt-3 text-sm leading-7 text-mute">{row.body}</p>
            </article>
          ))}
          <article className="panel rise rounded-[1.75rem] bg-ink p-5 text-paper sm:p-6">
            <p className="font-mono text-xs tracking-[0.24em] text-brand-soft uppercase">Status</p>
            <p className="mt-3 text-sm leading-7 text-paper/80">
              New public work lands in `packages/web`. Legacy behavior should only move across after an explicit keep
              decision.
            </p>
          </article>
        </section>
      </div>
    </main>
  )
}
