import { Wildcard } from "@/util/wildcard"
import type { PermissionNext } from "./next"

export function evaluate(permission: string, pattern: string, ...rulesets: PermissionNext.Ruleset[]): PermissionNext.Rule {
  const rules = rulesets.flat()
  const match = rules.findLast(
    (rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern),
  )
  return match ?? { action: "ask", permission, pattern: "*" }
}
