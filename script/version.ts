#!/usr/bin/env bun

import { Script } from "@symbolic-agent/script"
import { $ } from "bun"
import { buildNotes, getLatestRelease } from "./changelog"

const output = [`version=${Script.version}`]

async function view(tag: string) {
  const res = await fetch(`https://api.github.com/repos/${process.env.GH_REPO}/releases/tags/${tag}`, {
    headers: {
      ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}),
      Accept: "application/vnd.github+json",
    },
  })
  if (res.status === 404) return
  if (!res.ok) {
    throw new Error(`Failed to load release ${tag}: ${res.status} ${res.statusText}`)
  }
  const data = (await res.json()) as { id: number; tag_name: string }
  return {
    databaseId: data.id,
    tagName: data.tag_name,
  }
}

async function notes() {
  const file = Bun.file(`${process.cwd()}/UPCOMING_CHANGELOG.md`)
  if (await file.exists()) {
    const text = (await file.text()).trim()
    if (text) return text
  }

  const previous = await getLatestRelease()
  const list = previous ? await buildNotes(previous, "HEAD") : []
  return list.join("\n") || `Initial ${Script.version} release`
}

if (!Script.preview) {
  const body = await notes()
  const dir = process.env.RUNNER_TEMP ?? "/tmp"
  const file = `${dir}/symbolic-release-notes.txt`
  await Bun.write(file, body)
  const tag = `v${Script.version}`
  let release = await view(tag)
  if (!release) {
    await $`gh release create ${tag} -d --title ${tag} --notes-file ${file} --repo ${process.env.GH_REPO}`
    release = await view(tag)
  }
  if (!release) {
    throw new Error(`Failed to resolve release ${tag}`)
  }
  output.push(`release=${release.databaseId}`)
  output.push(`tag=${release.tagName}`)
} else if (Script.channel === "beta") {
  const tag = `v${Script.version}`
  let release = await view(tag)
  if (!release) {
    await $`gh release create ${tag} -d --title ${tag} --repo ${process.env.GH_REPO}`
    release = await view(tag)
  }
  if (!release) {
    throw new Error(`Failed to resolve release ${tag}`)
  }
  output.push(`release=${release.databaseId}`)
  output.push(`tag=${release.tagName}`)
}

output.push(`repo=${process.env.GH_REPO}`)

if (process.env.GITHUB_OUTPUT) {
  await Bun.write(process.env.GITHUB_OUTPUT, output.join("\n"))
}

process.exit(0)
