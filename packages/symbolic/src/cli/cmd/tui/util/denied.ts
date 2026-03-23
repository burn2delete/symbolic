export function isDenied(err?: string) {
  return !!(
    err?.includes("rejected permission") ||
    err?.includes("specified a rule") ||
    err?.includes("user dismissed") ||
    err?.includes("QuestionRejectedError")
  )
}
