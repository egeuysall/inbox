"use client";

import { formatDistanceToNow } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { LocalThought } from "@/lib/types";

type InboxListProps = {
  thoughts: LocalThought[];
  selectedThoughtId: string | null;
  isOnline: boolean;
  onSelect: (externalId: string) => void;
  onRunAi: (externalId: string) => void;
};

function getStatusLabel(thought: LocalThought) {
  if (thought.syncStatus === "local-only") {
    return "Saved locally";
  }

  if (thought.syncStatus === "syncing") {
    return "Syncing";
  }

  if (thought.syncStatus === "error") {
    return "Sync error";
  }

  if (thought.status === "processing") {
    return "AI running";
  }

  if (thought.status === "done") {
    return "AI done";
  }

  if (thought.status === "failed") {
    return "AI failed";
  }

  return "Synced";
}

function getStatusVariant(thought: LocalThought): "default" | "secondary" | "outline" | "destructive" {
  if (thought.status === "failed" || thought.syncStatus === "error") {
    return "destructive";
  }

  if (thought.status === "done") {
    return "default";
  }

  if (thought.syncStatus === "local-only" || thought.syncStatus === "syncing") {
    return "secondary";
  }

  return "outline";
}

export function InboxList({
  thoughts,
  selectedThoughtId,
  isOnline,
  onSelect,
  onRunAi,
}: InboxListProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col border-r">
      <header className="flex items-center justify-between px-4 py-3 md:px-6">
        <p className="text-sm">Inbox</p>
        <p className="text-xs text-muted-foreground">{thoughts.length}</p>
      </header>
      <Separator />

      {thoughts.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No captured thoughts yet</EmptyTitle>
              <EmptyDescription>Use the composer to add your first thought.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {thoughts.map((thought) => {
            const isSelected = thought.externalId === selectedThoughtId;

            return (
              <div key={thought.externalId} className="flex flex-col border-b px-4 py-3 md:px-6">
                <button
                  type="button"
                  onClick={() => onSelect(thought.externalId)}
                  className={cn(
                    "flex w-full flex-col items-start gap-2 border-l p-1 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    isSelected
                      ? "border-l-foreground text-foreground"
                      : "border-l-border/60 text-foreground/90 hover:border-l-muted-foreground",
                  )}
                >
                  <p className="line-clamp-2 text-sm leading-relaxed">{thought.rawText}</p>

                  <div className="flex w-full items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(thought.createdAt, { addSuffix: true })}
                    </p>
                    <Badge variant={getStatusVariant(thought)}>{getStatusLabel(thought)}</Badge>
                  </div>
                </button>

                <div className="mt-2 flex items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={!isOnline || thought.syncStatus !== "synced" || thought.status === "processing"}
                    onClick={() => onRunAi(thought.externalId)}
                  >
                    {thought.status === "failed" ? "Retry AI" : "Generate todos"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
