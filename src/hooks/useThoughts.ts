"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { ApiError, apiClient } from "@/lib/apiClient";
import {
  clearLocalThoughts,
  listLocalThoughts,
  upsertLocalThought,
  upsertManyLocalThoughts,
} from "@/lib/indexedDb";
import type {
  GenerationPreferences,
  LocalThought,
  ThoughtRecord,
  TodoItem,
  TodoStatus,
} from "@/lib/types";

const POLL_INTERVAL_MS = 15_000;
const AI_AUTO_SCHEDULE_STORAGE_KEY = "ibx:ai-auto-schedule";
const AI_INCLUDE_LINKS_STORAGE_KEY = "ibx:ai-include-links";
const AI_REQUIRE_DESCRIPTIONS_STORAGE_KEY = "ibx:ai-require-descriptions";
const AI_AVAILABILITY_NOTES_STORAGE_KEY = "ibx:ai-availability-notes";
const DEFAULT_AVAILABILITY_NOTES =
  "Mon-Tue unavailable before 6:00 PM. Wed-Fri unavailable before 5:00 PM. Sunday avoid 11:00 AM-12:00 PM and 7:00-8:00 PM. Hard stop at 10:30 PM daily. I execute about 4x faster than average; prefer short realistic estimates (15-30 minutes for quick tasks).";
const DEFAULT_EXECUTION_SPEED_MULTIPLIER = 4;

function sortThoughts(items: LocalThought[]) {
  return [...items].sort((a, b) => b.createdAt - a.createdAt);
}

function toLocalThought(input: ThoughtRecord): LocalThought {
  return {
    ...input,
    syncStatus: "synced",
    lastError: null,
  };
}

function mergeThoughts(current: LocalThought[], remoteThoughts: ThoughtRecord[]) {
  const byId = new Map(current.map((thought) => [thought.externalId, thought]));

  for (const remoteThought of remoteThoughts) {
    const existing = byId.get(remoteThought.externalId);
    byId.set(remoteThought.externalId, {
      ...toLocalThought(remoteThought),
      rawText: existing?.rawText ?? remoteThought.rawText,
      createdAt: existing?.createdAt ?? remoteThought.createdAt,
    });
  }

  return sortThoughts(Array.from(byId.values()));
}

function parseErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error.";
}

function readStoredGenerationPreferences(): GenerationPreferences {
  if (typeof window === "undefined") {
    return {
      autoSchedule: true,
      includeRelevantLinks: true,
      requireTaskDescriptions: true,
      availabilityNotes: DEFAULT_AVAILABILITY_NOTES,
      executionSpeedMultiplier: DEFAULT_EXECUTION_SPEED_MULTIPLIER,
    };
  }

  try {
    const availabilityNotes = window.localStorage.getItem(AI_AVAILABILITY_NOTES_STORAGE_KEY);
    return {
      autoSchedule: window.localStorage.getItem(AI_AUTO_SCHEDULE_STORAGE_KEY) !== "0",
      includeRelevantLinks:
        window.localStorage.getItem(AI_INCLUDE_LINKS_STORAGE_KEY) !== "0",
      requireTaskDescriptions:
        window.localStorage.getItem(AI_REQUIRE_DESCRIPTIONS_STORAGE_KEY) !== "0",
      availabilityNotes:
        availabilityNotes?.trim()?.slice(0, 640) || DEFAULT_AVAILABILITY_NOTES,
      executionSpeedMultiplier: DEFAULT_EXECUTION_SPEED_MULTIPLIER,
    };
  } catch {
    return {
      autoSchedule: true,
      includeRelevantLinks: true,
      requireTaskDescriptions: true,
      availabilityNotes: DEFAULT_AVAILABILITY_NOTES,
      executionSpeedMultiplier: DEFAULT_EXECUTION_SPEED_MULTIPLIER,
    };
  }
}

export function useThoughts(isOnline: boolean) {
  const [thoughts, setThoughts] = useState<LocalThought[]>([]);
  const [selectedThoughtId, setSelectedThoughtId] = useState<string | null>(null);
  const [todosByThought, setTodosByThought] = useState<Record<string, TodoItem[]>>({});
  const [lastError, setLastError] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isSyncing, startSyncTransition] = useTransition();
  const [isGenerating, startGenerateTransition] = useTransition();

  const thoughtsRef = useRef<LocalThought[]>([]);
  const runAiForThoughtRef = useRef<(externalId: string) => Promise<void>>(async () => {});

  useEffect(() => {
    thoughtsRef.current = thoughts;
  }, [thoughts]);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      try {
        const localThoughts = await listLocalThoughts();
        if (cancelled) {
          return;
        }

        setThoughts(localThoughts);
        setSelectedThoughtId((previous) => previous ?? localThoughts[0]?.externalId ?? null);
      } catch (error) {
        if (!cancelled) {
          setLastError(parseErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setIsHydrated(true);
        }
      }
    };

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    void upsertManyLocalThoughts(thoughts);
  }, [isHydrated, thoughts]);

  const refreshFromServer = useCallback(async () => {
    if (!isOnline) {
      return;
    }

    const { thoughts: remoteThoughts } = await apiClient.listThoughts();
    setThoughts((previousThoughts) => mergeThoughts(previousThoughts, remoteThoughts));
  }, [isOnline]);

  const syncPendingThoughts = useCallback(async () => {
    if (!isOnline) {
      return;
    }

    const pendingThoughts = thoughtsRef.current.filter(
      (thought) => thought.syncStatus === "local-only" || thought.syncStatus === "error",
    );

    if (pendingThoughts.length === 0) {
      return;
    }

    const pendingIds = new Set(pendingThoughts.map((thought) => thought.externalId));

    setThoughts((previousThoughts) =>
      previousThoughts.map((thought) =>
        pendingIds.has(thought.externalId)
          ? { ...thought, syncStatus: "syncing", lastError: null }
          : thought,
      ),
    );

    try {
      const { thoughts: syncedThoughts } = await apiClient.syncThoughts(
        pendingThoughts.map((thought) => ({
          externalId: thought.externalId,
          rawText: thought.rawText,
          createdAt: thought.createdAt,
          status: thought.status,
          aiRunId: thought.aiRunId,
        })),
      );

      setThoughts((previousThoughts) => mergeThoughts(previousThoughts, syncedThoughts));
      setLastError(null);
    } catch (error) {
      const errorMessage = parseErrorMessage(error);
      setLastError(errorMessage);
      setThoughts((previousThoughts) =>
        previousThoughts.map((thought) =>
          pendingIds.has(thought.externalId)
            ? {
                ...thought,
                syncStatus: "error",
                lastError: errorMessage,
              }
            : thought,
        ),
      );
    }
  }, [isOnline]);

  const loadTodosForThought = useCallback(
    async (externalId: string) => {
      if (!isOnline) {
        return;
      }

      const { todos } = await apiClient.listTodos(externalId);
      setTodosByThought((previous) => ({ ...previous, [externalId]: todos }));
    },
    [isOnline],
  );

  useEffect(() => {
    if (!isHydrated || !isOnline) {
      return;
    }

    startSyncTransition(() => {
      void syncPendingThoughts();
      void refreshFromServer();
    });

    const onFocus = () => {
      startSyncTransition(() => {
        void syncPendingThoughts();
        void refreshFromServer();
      });
    };

    const timer = window.setInterval(() => {
      startSyncTransition(() => {
        void syncPendingThoughts();
        void refreshFromServer();
      });
    }, POLL_INTERVAL_MS);

    window.addEventListener("focus", onFocus);

    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [isHydrated, isOnline, refreshFromServer, startSyncTransition, syncPendingThoughts]);

  useEffect(() => {
    if (!selectedThoughtId || !isOnline) {
      return;
    }

    void loadTodosForThought(selectedThoughtId);
  }, [isOnline, loadTodosForThought, selectedThoughtId]);

  const saveThought = useCallback(
    async (rawText: string, runAi: boolean) => {
      const cleanText = rawText.trim();
      if (!cleanText) {
        return null;
      }

      const now = Date.now();
      const externalId = crypto.randomUUID();

      const localThought: LocalThought = {
        externalId,
        rawText: cleanText,
        createdAt: now,
        status: "pending",
        synced: false,
        aiRunId: null,
        syncStatus: "local-only",
        lastError: null,
      };

      setThoughts((previousThoughts) => sortThoughts([...previousThoughts, localThought]));
      setSelectedThoughtId(externalId);
      await upsertLocalThought(localThought);

      if (!isOnline) {
        if (runAi) {
          setLastError("AI requires connection - your thoughts are saved locally.");
        }
        return externalId;
      }

      await syncPendingThoughts();

      if (runAi) {
        startGenerateTransition(() => {
          void runAiForThoughtRef.current(externalId);
        });
      }

      return externalId;
    },
    [isOnline, startGenerateTransition, syncPendingThoughts],
  );

  const runAiForThought = useCallback(
    async (externalId: string) => {
      if (!isOnline) {
        setLastError("AI requires connection - your thoughts are saved locally.");
        return;
      }

      setThoughts((previousThoughts) =>
        previousThoughts.map((thought) =>
          thought.externalId === externalId
            ? {
                ...thought,
                status: "processing",
                syncStatus: thought.syncStatus === "synced" ? "synced" : "syncing",
                lastError: null,
              }
            : thought,
        ),
      );

      try {
        await apiClient.generateTodos(externalId, readStoredGenerationPreferences());
        await Promise.all([refreshFromServer(), loadTodosForThought(externalId)]);
        setLastError(null);
      } catch (error) {
        const errorMessage = parseErrorMessage(error);
        setLastError(errorMessage);

        setThoughts((previousThoughts) =>
          previousThoughts.map((thought) =>
            thought.externalId === externalId
              ? {
                  ...thought,
                  status: "failed",
                  lastError: errorMessage,
                }
              : thought,
          ),
        );
      }
    },
    [isOnline, loadTodosForThought, refreshFromServer],
  );

  useEffect(() => {
    runAiForThoughtRef.current = runAiForThought;
  }, [runAiForThought]);

  const selectThought = useCallback(
    (externalId: string) => {
      setSelectedThoughtId(externalId);
      if (isOnline) {
        void loadTodosForThought(externalId);
      }
    },
    [isOnline, loadTodosForThought],
  );

  const addTodo = useCallback(
    async (externalId: string, title: string, notes: string | null) => {
      const cleanTitle = title.trim();
      if (!cleanTitle) {
        return;
      }

      await apiClient.createTodo(externalId, cleanTitle, notes);
      await Promise.all([loadTodosForThought(externalId), refreshFromServer()]);
    },
    [loadTodosForThought, refreshFromServer],
  );

  const toggleTodo = useCallback(
    async (externalId: string, todoId: string, status: TodoStatus) => {
      const previousTodos = todosByThought[externalId] ?? [];
      const nextStatus: TodoStatus = status === "open" ? "done" : "open";

      setTodosByThought((previous) => ({
        ...previous,
        [externalId]: (previous[externalId] ?? []).map((todo) =>
          todo.id === todoId ? { ...todo, status: nextStatus } : todo,
        ),
      }));

      try {
        await apiClient.updateTodo(todoId, { status: nextStatus });
        await refreshFromServer();
      } catch (error) {
        setTodosByThought((previous) => ({ ...previous, [externalId]: previousTodos }));
        setLastError(parseErrorMessage(error));
      }
    },
    [refreshFromServer, todosByThought],
  );

  const clearLocalData = useCallback(async () => {
    await clearLocalThoughts();
    setThoughts([]);
    setTodosByThought({});
    setSelectedThoughtId(null);
  }, []);

  const selectedThought = useMemo(
    () => thoughts.find((thought) => thought.externalId === selectedThoughtId) ?? null,
    [selectedThoughtId, thoughts],
  );

  const selectedTodos = selectedThoughtId ? todosByThought[selectedThoughtId] ?? [] : [];

  const syncLabel = useMemo(() => {
    if (!thoughts.length) {
      return "Idle";
    }

    if (thoughts.some((thought) => thought.syncStatus === "syncing")) {
      return "Syncing...";
    }

    if (thoughts.some((thought) => thought.syncStatus === "local-only")) {
      return "Local only";
    }

    if (thoughts.some((thought) => thought.syncStatus === "error")) {
      return "Sync error";
    }

    return "All synced";
  }, [thoughts]);

  return {
    thoughts,
    selectedThought,
    selectedThoughtId,
    selectedTodos,
    syncLabel,
    isSyncing,
    isGenerating,
    lastError,
    saveThought,
    selectThought,
    addTodo,
    toggleTodo,
    runAiForThought,
    clearLocalData,
    syncPendingThoughts,
    refreshFromServer,
  };
}
