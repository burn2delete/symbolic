declare module "lucide-react" {
  import type * as React from "react";

  export type LucideProps = React.SVGProps<SVGSVGElement> &
    React.RefAttributes<SVGSVGElement> & {
      size?: string | number;
      absoluteStrokeWidth?: boolean;
    };

  export type LucideIcon = React.ComponentType<LucideProps>;

  export const Check: LucideIcon;
  export const ChevronDown: LucideIcon;
  export const ChevronRight: LucideIcon;
  export const BinaryIcon: LucideIcon;
  export const BotIcon: LucideIcon;
  export const BrainIcon: LucideIcon;
  export const FolderOpenIcon: LucideIcon;
  export const GemIcon: LucideIcon;
  export const GhostIcon: LucideIcon;
  export const MonitorIcon: LucideIcon;
  export const MoonIcon: LucideIcon;
  export const PanelLeftIcon: LucideIcon;
  export const PlusIcon: LucideIcon;
  export const RotateCcwIcon: LucideIcon;
  export const Settings2Icon: LucideIcon;
  export const SparklesIcon: LucideIcon;
  export const SquareCodeIcon: LucideIcon;
  export const SquareTerminalIcon: LucideIcon;
  export const SunIcon: LucideIcon;
  export const XIcon: LucideIcon;
}
