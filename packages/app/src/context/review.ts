import type { VcsInfo } from "./global-sync/types"

export const REVIEW_SOURCES = ["session", "working_tree", "default_branch", "branch", "pr"] as const

export type ReviewSource = (typeof REVIEW_SOURCES)[number]

export type ReviewRepoQuery =
  | {
      mode: "git"
    }
  | {
      mode: "branch"
    }

export type ReviewResolved =
  | {
      kind: "session"
      source: "session"
    }
  | {
      kind: "repo"
      source: Exclude<ReviewSource, "session" | "pr">
      query: ReviewRepoQuery
      key: string
    }
  | {
      kind: "unsupported"
      source: ReviewSource
      reason: "non_git" | "missing_default_branch" | "missing_branch" | "pr"
    }

const repoKey = (input: { directory: string; mode: string }) => [input.directory, input.mode].join("\n")

export function resolveReview(input: { source: ReviewSource; vcs?: VcsInfo; directory: string }): ReviewResolved {
  if (input.source === "session") {
    return { kind: "session", source: input.source }
  }

  if (!input.vcs) {
    return { kind: "unsupported", source: input.source, reason: "non_git" }
  }

  if (input.source === "working_tree") {
    const query = { mode: "git" } as const
    return { kind: "repo", source: input.source, query, key: repoKey({ directory: input.directory, mode: query.mode }) }
  }

  if (input.source === "default_branch") {
    if (!input.vcs.default_branch) {
      return { kind: "unsupported", source: input.source, reason: "missing_default_branch" }
    }
    return {
      kind: "repo",
      source: input.source,
      query: { mode: "branch" },
      key: repoKey({ directory: input.directory, mode: "branch" }),
    }
  }

  if (input.source === "branch") {
    if (!input.vcs.default_branch) {
      return { kind: "unsupported", source: input.source, reason: "missing_default_branch" }
    }
    if (!input.vcs.branch) {
      return { kind: "unsupported", source: input.source, reason: "missing_branch" }
    }
    return {
      kind: "repo",
      source: input.source,
      query: { mode: "branch" },
      key: repoKey({ directory: input.directory, mode: "branch" }),
    }
  }

  return { kind: "unsupported", source: input.source, reason: "pr" }
}

export function reviewSourceKey(source: ReviewSource) {
  switch (source) {
    case "session":
      return "ui.sessionReview.title"
    case "working_tree":
      return "session.review.source.workingTree"
    case "default_branch":
      return "session.review.source.defaultBranch"
    case "branch":
      return "session.review.source.branch"
    case "pr":
      return "session.review.source.pr"
  }
}

export function reviewEmptyKey(input: { resolved: ReviewResolved; projectVcs?: boolean; snapshot?: boolean }) {
  if (input.projectVcs === false) return "session.review.noVcs"

  if (input.resolved.kind === "unsupported") {
    if (input.resolved.reason === "missing_default_branch") return "session.review.noDefaultBranch"
    if (input.resolved.reason === "missing_branch") return "session.review.noBranch"
    if (input.resolved.reason === "pr") return "session.review.prUnsupported"
    return "session.review.repoUnsupported"
  }

  if (input.resolved.kind === "repo") {
    return "session.review.noRepoChanges"
  }

  if (input.snapshot === false) return "session.review.noSnapshot"
  return "session.review.empty"
}
