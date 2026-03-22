import Link from "next/link"

export default function Page() {
  const picks = [
    {
      name: "Fresh boundary",
      body: "The new web package starts clean. Legacy docs and share flows stay parked in web-legacy while this surface grows on purpose.",
    },
    {
      name: "Fast stack",
      body: "Next.js app routing gives us layouts, streaming, and route boundaries without dragging the old Astro-based shape into the fork.",
    },
    {
      name: "Tailwind v4",
      body: "Design tokens live in CSS, not config sprawl, so the package stays small while still feeling deliberate and expressive.",
    },
  ]

  const notes = ["App Router", "Tailwind v4", "Bun workspace", "Legacy handoff"]

  const steps = [
    {
      name: "Stabilize routes",
      body: "Keep the shell simple while new landing, docs, and product pages take shape.",
    },
    {
      name: "Decide public scope",
      body: "Move only the surfaces worth keeping from web-legacy, not the whole package history.",
    },
    {
      name: "Reconnect deploy",
      body: "Once the routes and content settle, wire this package back into deploy and docs automation.",
    },
  ]

  return (
    <main className="px-5 pb-8 pt-8 sm:px-8 lg:px-10 lg:pt-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rise flex flex-col gap-6 rounded-[2rem] border border-line/80 bg-paper/70 px-6 py-8 sm:px-8 sm:py-10 lg:px-10">
            <div className="flex flex-wrap gap-2">
              {notes.map((note) => (
                <span
                  key={note}
                  className="rounded-full border border-line bg-white/70 px-3 py-1 font-mono text-[11px] tracking-[0.22em] text-mute uppercase"
                >
                  {note}
                </span>
              ))}
            </div>
            <div className="max-w-3xl space-y-5">
              <p className="font-mono text-xs tracking-[0.3em] text-brand uppercase">New web foundation</p>
              <h1 className="max-w-4xl text-5xl leading-none font-medium text-balance sm:text-6xl lg:text-7xl">
                A new public web surface for the Symbolic fork.
              </h1>
              <p className="max-w-2xl text-base leading-7 text-mute sm:text-lg">
                This package is the reset button: Next.js, app routing, Tailwind v4, and a cleaner place to decide what
                the public face of Symbolic should become.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <a
                className="inline-flex items-center justify-center rounded-full bg-ink px-5 py-3 text-sm font-medium text-paper transition hover:bg-brand"
                href="#stack"
              >
                Explore the stack
              </a>
              <Link
                className="inline-flex items-center justify-center rounded-full border border-line bg-white/70 px-5 py-3 text-sm font-medium text-ink transition hover:border-brand hover:text-brand"
                href="/legacy"
              >
                See the legacy handoff
              </Link>
            </div>
          </div>

          <aside className="rise float panel rounded-[2rem] p-5 sm:p-6">
            <div className="space-y-5">
              <div>
                <p className="font-mono text-xs tracking-[0.24em] text-brand uppercase">Build note</p>
                <h2 className="mt-3 text-2xl font-medium">Start small, leave space for the real product site.</h2>
              </div>
              <div className="space-y-3 text-sm text-mute">
                <p>The old package carried docs, public marketing, and hosted share rendering all at once.</p>
                <p>
                  This one starts as a focused shell so we can rebuild deliberately instead of inheriting a tangled
                  boundary.
                </p>
              </div>
              <div className="rounded-[1.5rem] border border-line bg-ink px-4 py-4 text-paper">
                <p className="font-mono text-[11px] tracking-[0.24em] uppercase text-brand-soft">Current route map</p>
                <div className="mt-4 space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-3">
                    <span>Home</span>
                    <span className="font-mono text-brand-soft">/</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Legacy handoff</span>
                    <span className="font-mono text-brand-soft">/legacy</span>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {picks.map((pick, i) => (
            <article
              key={pick.name}
              className="panel rise rounded-[1.75rem] p-5 sm:p-6"
              style={{ animationDelay: `${i * 120}ms` }}
            >
              <p className="font-mono text-xs tracking-[0.24em] text-brand uppercase">0{i + 1}</p>
              <h2 className="mt-4 text-2xl font-medium">{pick.name}</h2>
              <p className="mt-3 text-sm leading-7 text-mute">{pick.body}</p>
            </article>
          ))}
        </section>

        <section id="stack" className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="panel rise rounded-[2rem] p-6 sm:p-8">
            <p className="font-mono text-xs tracking-[0.24em] text-brand uppercase">Stack</p>
            <h2 className="mt-4 text-3xl font-medium text-balance">A clean scaffold with obvious next moves.</h2>
            <div className="mt-6 space-y-5">
              {steps.map((step, i) => (
                <div key={step.name} className="border-t border-line/80 pt-4 first:border-t-0 first:pt-0">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand/15 font-mono text-xs text-brand">
                      {i + 1}
                    </span>
                    <h3 className="text-lg font-medium">{step.name}</h3>
                  </div>
                  <p className="mt-3 text-sm leading-7 text-mute">{step.body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="panel rise rounded-[2rem] p-6 sm:p-8">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-xs tracking-[0.24em] text-brand uppercase">Shape</p>
                <h2 className="mt-3 text-2xl font-medium">packages/web</h2>
              </div>
              <span className="rounded-full border border-line bg-white/70 px-3 py-1 font-mono text-[11px] tracking-[0.22em] text-mute uppercase">
                app router
              </span>
            </div>
            <pre className="mt-6 overflow-x-auto rounded-[1.5rem] bg-[#1f1a17] p-5 text-sm leading-7 text-[#f7efdf]">
              <code>{`packages/web/
  app/
    layout.tsx
    page.tsx
    legacy/page.tsx
    globals.css
  next.config.ts
  postcss.config.mjs
  tsconfig.json`}</code>
            </pre>
            <p className="mt-4 text-sm leading-7 text-mute">
              The new package is intentionally thin. That makes it easy to wire back into deploy later without dragging
              the deprecated docs and share surface along for the ride.
            </p>
          </div>
        </section>
      </div>
    </main>
  )
}
