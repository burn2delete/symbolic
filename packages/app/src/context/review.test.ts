import { describe, expect, test } from "bun:test"
import type { VcsInfo } from "./global-sync/types"
import { REVIEW_SOURCES, resolveReview, reviewEmptyKey, reviewSourceKey } from "./review"

describe("review helper", () => {
  test("resolves session and repo review sources", () => {
    const vcs: VcsInfo = {
      dirty: true,
      branch: "feature/demo",
      default_branch: "main",
      head: "HEAD",
    }

    expect(resolveReview({ source: "session", directory: "/tmp" })).toEqual({
      kind: "session",
      source: "session",
    })
    expect(resolveReview({ source: "working_tree", directory: "/tmp", vcs })).toEqual({
      kind: "repo",
      source: "working_tree",
      query: { mode: "working_tree" },
      key: "/tmp\nworking_tree\n\n",
    })
    expect(resolveReview({ source: "default_branch", directory: "/tmp", vcs })).toEqual({
      kind: "repo",
      source: "default_branch",
      query: { mode: "range", base: "main", head: "HEAD" },
      key: "/tmp\nrange\nmain\nHEAD",
    })
    expect(resolveReview({ source: "branch", directory: "/tmp", vcs })).toEqual({
      kind: "repo",
      source: "branch",
      query: { mode: "range", base: "main", head: "feature/demo" },
      key: "/tmp\nrange\nmain\nfeature/demo",
    })
  })

  test("reports unsupported review states", () => {
    expect(resolveReview({ source: "working_tree", directory: "/tmp" })).toEqual({
      kind: "unsupported",
      source: "working_tree",
      reason: "non_git",
    })
    expect(resolveReview({ source: "default_branch", directory: "/tmp", vcs: { dirty: false } })).toEqual({
      kind: "unsupported",
      source: "default_branch",
      reason: "missing_default_branch",
    })
    expect(resolveReview({
      source: "branch",
      directory: "/tmp",
      vcs: { dirty: false, default_branch: "main" },
    })).toEqual({
      kind: "unsupported",
      source: "branch",
      reason: "missing_branch",
    })
    expect(resolveReview({
      source: "pr",
      directory: "/tmp",
      vcs: { dirty: false, default_branch: "main", branch: "demo" },
    })).toEqual({
      kind: "unsupported",
      source: "pr",
      reason: "pr",
    })
  })

  test("returns empty-state keys for review modes", () => {
    expect(
      reviewEmptyKey({
        resolved: { kind: "unsupported", source: "working_tree", reason: "non_git" },
        projectVcs: false,
      }),
    ).toBe("session.review.noVcs")
    expect(
      reviewEmptyKey({
        resolved: { kind: "unsupported", source: "default_branch", reason: "missing_default_branch" },
      }),
    ).toBe("session.review.noDefaultBranch")
    expect(
      reviewEmptyKey({
        resolved: { kind: "unsupported", source: "branch", reason: "missing_branch" },
      }),
    ).toBe("session.review.noBranch")
    expect(
      reviewEmptyKey({ resolved: { kind: "unsupported", source: "pr", reason: "pr" } }),
    ).toBe("session.review.prUnsupported")
    expect(
      reviewEmptyKey({
        resolved: { kind: "repo", source: "working_tree", query: { mode: "working_tree" }, key: "k" },
      }),
    ).toBe("session.review.noRepoChanges")
    expect(reviewEmptyKey({ resolved: { kind: "session", source: "session" }, snapshot: false })).toBe(
      "session.review.noSnapshot",
    )
    expect(reviewEmptyKey({ resolved: { kind: "session", source: "session" } })).toBe("session.review.empty")
  })

  test("labels review sources", () => {
    expect(REVIEW_SOURCES).toEqual(["session", "working_tree", "default_branch", "branch", "pr"])
    expect(reviewSourceKey("working_tree")).toBe("session.review.source.workingTree")
    expect(reviewSourceKey("default_branch")).toBe("session.review.source.defaultBranch")
    expect(reviewSourceKey("branch")).toBe("session.review.source.branch")
    expect(reviewSourceKey("pr")).toBe("session.review.source.pr")
  })
})
