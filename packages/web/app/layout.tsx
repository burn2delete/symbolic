import type { Metadata } from "next"
import Link from "next/link"
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google"
import "./globals.css"

const sans = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space",
})

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex",
})

export const metadata: Metadata = {
  title: {
    default: "Symbolic Web",
    template: "%s | Symbolic Web",
  },
  description: "A fresh Next.js web surface for the Symbolic fork.",
}

export default function RootLayout(props: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${mono.variable} font-sans text-ink antialiased`}>
        <div className="mesh min-h-screen">
          <header className="px-5 pt-5 sm:px-8 lg:px-10">
            <div className="panel beam mx-auto flex max-w-6xl items-center justify-between rounded-full px-4 py-3 sm:px-5">
              <Link className="flex items-center gap-3 text-sm font-medium tracking-[0.24em] uppercase" href="/">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-ink text-paper">
                  S
                </span>
                <span>Symbolic Web</span>
              </Link>
              <nav className="flex items-center gap-2 text-sm text-mute sm:gap-5">
                <Link className="transition hover:text-ink" href="/">
                  Home
                </Link>
                <Link className="transition hover:text-ink" href="/legacy">
                  Legacy
                </Link>
                <a
                  className="transition hover:text-ink"
                  href="https://github.com/SymbolicOS/symbolic"
                  target="_blank"
                  rel="noreferrer"
                >
                  GitHub
                </a>
              </nav>
            </div>
          </header>
          {props.children}
          <footer className="px-5 pb-8 pt-10 text-sm text-mute sm:px-8 lg:px-10">
            <div className="mx-auto flex max-w-6xl flex-col gap-3 border-t border-line/80 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <p>Next.js app router, Tailwind v4, and a clean place to rebuild the public web surface.</p>
              <p className="font-mono text-xs uppercase tracking-[0.2em]">packages/web</p>
            </div>
          </footer>
        </div>
      </body>
    </html>
  )
}
