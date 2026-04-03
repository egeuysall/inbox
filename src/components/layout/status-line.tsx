import { Badge } from "@/components/ui/badge";

type StatusLineProps = {
  isOnline: boolean;
  syncLabel: string;
  thoughtCount: number;
};

export function StatusLine({ isOnline, syncLabel, thoughtCount }: StatusLineProps) {
  return (
    <footer className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground md:px-6">
      <div className="flex items-center gap-2">
        <span className="font-mono">&gt;</span>
        <span>{isOnline ? "Online" : "Offline"}</span>
      </div>

      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[0.68rem]">
          {syncLabel}
        </Badge>
        <span>{thoughtCount} thoughts</span>
      </div>
    </footer>
  );
}
