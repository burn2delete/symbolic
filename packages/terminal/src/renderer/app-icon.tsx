import { BinaryIcon, BotIcon, BrainIcon, GemIcon, GhostIcon, SparklesIcon, SquareCodeIcon } from "lucide-react";
import type { ComponentProps, ComponentType } from "react";

import type { Launch } from "../shared/api";

import { Term } from "./term-data";

type Icon = ComponentType<ComponentProps<"svg">>;

export function glyph(launch?: Pick<Launch, "id"> | null): Icon {
  if (launch?.id === "symbolic") return SparklesIcon as Icon;
  if (launch?.id === "codex") return SquareCodeIcon as Icon;
  if (launch?.id === "claude") return BrainIcon as Icon;
  if (launch?.id === "gemini") return GemIcon as Icon;
  if (launch?.id === "copilot") return BotIcon as Icon;
  if (launch?.id === "opencode") return BinaryIcon as Icon;
  if (launch?.id === "ghosty") return GhostIcon as Icon;
  return Term;
}
