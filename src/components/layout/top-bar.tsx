"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type TopBarProps = {
  isOnline: boolean;
  syncLabel: string;
};

export function TopBar({ isOnline, syncLabel }: TopBarProps) {
  return (
    <header className="flex items-center justify-between border-b px-4 py-3 md:px-6">
      <div className="flex items-center gap-2">
        <p className="text-sm tracking-tight">Inbox</p>
        <span className="text-muted-foreground">{"///"}</span>
        <p className="text-sm text-muted-foreground">Todos</p>
      </div>

      <div className="flex items-center gap-2">
        <Badge variant="outline" className="hidden sm:inline-flex">
          {isOnline ? "Online" : "Offline"}
        </Badge>
        <Badge variant="secondary" className="hidden sm:inline-flex">
          {syncLabel}
        </Badge>

        <Button variant="ghost" size="sm" render={<Link href="/settings" prefetch={false} />}>
          settings
        </Button>
      </div>
    </header>
  );
}
