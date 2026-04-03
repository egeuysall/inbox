export type ThoughtStatus = "pending" | "processing" | "done" | "failed";

export type SyncStatus = "local-only" | "syncing" | "synced" | "error";

export type TodoStatus = "open" | "done";
export type TodoRecurrence = "none" | "daily" | "weekly" | "monthly";
export type TodoSource = "ai" | "manual";

export type TodoItem = {
  id: string;
  thoughtId: string;
  title: string;
  notes: string | null;
  status: TodoStatus;
  dueDate: number | null;
  recurrence: TodoRecurrence;
  source: TodoSource;
  createdAt: number;
};

export type ThoughtRecord = {
  externalId: string;
  rawText: string;
  createdAt: number;
  status: ThoughtStatus;
  synced: boolean;
  aiRunId: string | null;
};

export type LocalThought = ThoughtRecord & {
  syncStatus: SyncStatus;
  lastError: string | null;
};

export type SyncThoughtInput = {
  externalId: string;
  rawText: string;
  createdAt: number;
  status: ThoughtStatus;
  aiRunId: string | null;
};
