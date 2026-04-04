"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { toast } from "sonner";

import { LoginScreen } from "@/components/auth/login-screen";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useOfflineStatus } from "@/hooks/useOfflineStatus";
import { useTheme } from "@/hooks/useTheme";
import { apiClient, ApiError } from "@/lib/apiClient";
import {
  addQueuedPrompt,
  listQueuedPrompts,
  patchQueuedPrompt,
  removeQueuedPrompt,
} from "@/lib/indexedDb";
import { cn } from "@/lib/utils";
import type { TodoItem, TodoPriority, TodoRecurrence } from "@/lib/types";

type AppShellProps = {
  initialAuthenticated: boolean;
  initialFilter?: TodoFilter;
};

const PROMPT_INPUT_STORAGE_KEY = "ibx:prompt-input";
const FILTER_STORAGE_KEY = "ibx:active-view";
const PROMPT_AUTOFOCUS_STORAGE_KEY = "ibx:prompt-autofocus";
const SHORTCUT_CAPTURE_KEY_PREFIX = "ibx:shortcut-capture:";
const NOTE_PREVIEW_LENGTH = 160;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOLD_PROGRESS_DELAY_MS = 160;
const HOLD_PROGRESS_SWEEP_MS = 300;
const HOLD_TO_TOGGLE_MS = HOLD_PROGRESS_DELAY_MS + HOLD_PROGRESS_SWEEP_MS;
const HOLD_MOVE_CANCEL_PX = 24;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const UTC_LONG_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const UTC_SHORT_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "2-digit",
  day: "2-digit",
  timeZone: "UTC",
});
const LOCAL_STATUS_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function readStoredPromptInput() {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    return window.localStorage.getItem(PROMPT_INPUT_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function readStoredFilter() {
  if (typeof window === "undefined") {
    return "today" as TodoFilter;
  }

  try {
    return normalizeFilter(window.localStorage.getItem(FILTER_STORAGE_KEY));
  } catch {
    return "today" as TodoFilter;
  }
}

function readStoredPromptAutofocus() {
  if (typeof window === "undefined") {
    return true;
  }

  try {
    return window.localStorage.getItem(PROMPT_AUTOFOCUS_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

function getLocalDateKey(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getTodoDateKey(timestamp: number | null) {
  if (typeof timestamp !== "number") {
    return null;
  }

  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isTodoOnDateKey(timestamp: number | null, dateKey: string) {
  return getTodoDateKey(timestamp) === dateKey;
}

function dateKeyToTimestamp(dateKey: string) {
  const timestamp = Date.parse(`${dateKey}T00:00:00.000Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function dateKeyToLocalDate(dateKey: string) {
  const [yearText, monthText, dayText] = dateKey.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return null;
  }

  return new Date(year, month - 1, day);
}

function formatDateKey(dateKey: string, formatter: Intl.DateTimeFormat) {
  if (!ISO_DATE_REGEX.test(dateKey)) {
    return "no date";
  }

  const timestamp = dateKeyToTimestamp(dateKey);
  if (timestamp === null) {
    return "no date";
  }

  return formatter.format(new Date(timestamp));
}

function displayDueDate(timestamp: number | null) {
  const dateKey = getTodoDateKey(timestamp);
  if (!dateKey) {
    return "no date";
  }

  return formatDateKey(dateKey, UTC_LONG_DATE_FORMATTER);
}

function displayDateInputValue(timestamp: number | null) {
  const dateKey = getTodoDateKey(timestamp);
  if (!dateKey) {
    return "mm/dd/yyyy";
  }

  return formatDateKey(dateKey, UTC_SHORT_DATE_FORMATTER);
}

function getLocalStatusLabel(timestamp: number) {
  return LOCAL_STATUS_TIME_FORMATTER.format(new Date(timestamp)).toLowerCase();
}

function parseErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error";
}

function displayRecurrence(recurrence: TodoRecurrence) {
  if (recurrence === "none") {
    return "once";
  }

  return recurrence;
}

function normalizeTodoPriority(
  priority: number | null | undefined,
): TodoPriority {
  if (priority === 1 || priority === 3) {
    return priority;
  }

  return 2;
}

function displayPriority(priority: number) {
  return `p${normalizeTodoPriority(priority)}`;
}

function getPreviewNotes(notes: string) {
  if (notes.length <= NOTE_PREVIEW_LENGTH) {
    return notes;
  }

  return `${notes.slice(0, NOTE_PREVIEW_LENGTH)}…`;
}

function isInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest(
      "button, input, select, textarea, a, [role='button'], [data-hold-ignore='true']",
    ),
  );
}

function sortTodos(todos: TodoItem[]) {
  return [...todos].sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === "open" ? -1 : 1;
    }

    const aPriority = normalizeTodoPriority(a.priority);
    const bPriority = normalizeTodoPriority(b.priority);

    if (a.status === "open" && b.status === "open" && aPriority !== bPriority) {
      return aPriority - bPriority;
    }

    const aDueDate = a.dueDate ?? Number.MAX_SAFE_INTEGER;
    const bDueDate = b.dueDate ?? Number.MAX_SAFE_INTEGER;

    if (aDueDate !== bDueDate) {
      return aDueDate - bDueDate;
    }

    return b.createdAt - a.createdAt;
  });
}

function getStartOfLocalDay(timestamp: number) {
  const date = new Date(timestamp);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

function getRelativeDayLabel(dateKey: string, now: number) {
  if (!ISO_DATE_REGEX.test(dateKey)) {
    return null;
  }

  const targetDate = dateKeyToLocalDate(dateKey);
  if (!targetDate) {
    return null;
  }

  const targetStart = targetDate.getTime();
  const todayStart = getStartOfLocalDay(now);
  const diffDays = Math.round((targetStart - todayStart) / DAY_MS);

  if (diffDays === 0) {
    return "today";
  }

  if (diffDays === 1) {
    return "tomorrow";
  }

  if (diffDays === -1) {
    return "yesterday";
  }

  if (diffDays > 1) {
    return `in ${diffDays}d`;
  }

  return `${Math.abs(diffDays)}d ago`;
}

function formatSectionDateLabel(
  dateKey: string | null,
  filter: TodoFilter,
  now: number,
) {
  if (dateKey === null) {
    return "no date";
  }

  const formattedDate = formatDateKey(dateKey, UTC_SHORT_DATE_FORMATTER);
  if (filter !== "upcoming" && filter !== "archive") {
    return formattedDate;
  }

  const relativeLabel = getRelativeDayLabel(dateKey, now);
  return relativeLabel ? `${formattedDate} // ${relativeLabel}` : formattedDate;
}

type TodoFilter = "today" | "upcoming" | "archive";
type TodoSection = {
  key: string;
  label: string | null;
  todos: TodoItem[];
};

const TODAY_PRIORITY_LABELS: Record<TodoPriority, string> = {
  1: "p1 // must-do",
  2: "p2 // should-do",
  3: "p3 // could-do",
};

function normalizeFilter(value: string | null | undefined): TodoFilter {
  if (value === "upcoming" || value === "archive") {
    return value;
  }

  return "today";
}

export function AppShell({ initialAuthenticated }: AppShellProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  useTheme();
  const isOnline = useOfflineStatus();

  const [isAuthenticated, setIsAuthenticated] = useState(initialAuthenticated);
  const [filter, setFilter] = useState<TodoFilter>("today");
  const [promptInput, setPromptInput] = useState("");
  const [promptAutofocus, setPromptAutofocus] = useState(false);
  const [hasHydratedPreferences, setHasHydratedPreferences] = useState(false);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [hasLoadedTodos, setHasLoadedTodos] = useState(false);
  const [isLoadingTodos, setIsLoadingTodos] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);
  const [queuedPromptCount, setQueuedPromptCount] = useState(0);
  const [pendingTodoId, setPendingTodoId] = useState<string | null>(null);
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
  const [holdingTodoId, setHoldingTodoId] = useState<string | null>(null);
  const [holdProgress, setHoldProgress] = useState(0);
  const [expandedNoteIds, setExpandedNoteIds] = useState<
    Record<string, boolean>
  >({});
  const [currentTimestamp, setCurrentTimestamp] = useState(() => Date.now());
  const promptInputRef = useRef<HTMLInputElement | null>(null);
  const hasAppliedInitialAutofocus = useRef(false);
  const isQueueFlushRunning = useRef(false);
  const holdTimerRef = useRef<number | null>(null);
  const holdAnimationFrameRef = useRef<number | null>(null);
  const holdStartedAtRef = useRef<number | null>(null);
  const holdStartRef = useRef<{ x: number; y: number } | null>(null);
  const heldTodoIdRef = useRef<string | null>(null);
  const suppressNextClickRef = useRef(false);

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const clearHoldAnimation = useCallback(() => {
    if (holdAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(holdAnimationFrameRef.current);
      holdAnimationFrameRef.current = null;
    }

    holdStartedAtRef.current = null;
    setHoldingTodoId(null);
    setHoldProgress(0);
  }, []);

  const cancelHoldInteraction = useCallback(() => {
    clearHoldTimer();
    clearHoldAnimation();
    holdStartRef.current = null;
    heldTodoIdRef.current = null;
  }, [clearHoldAnimation, clearHoldTimer]);

  useEffect(() => {
    setFilter(readStoredFilter());
    setPromptInput(readStoredPromptInput());
    setPromptAutofocus(readStoredPromptAutofocus());
    setHasHydratedPreferences(true);
  }, []);

  useEffect(
    () => () => {
      cancelHoldInteraction();
    },
    [cancelHoldInteraction],
  );

  useEffect(() => {
    if (!hasHydratedPreferences) {
      return;
    }

    try {
      window.localStorage.setItem(PROMPT_INPUT_STORAGE_KEY, promptInput);
    } catch {
      // Ignore localStorage failures (private mode, blocked storage)
    }
  }, [hasHydratedPreferences, promptInput]);

  useEffect(() => {
    if (!hasHydratedPreferences) {
      return;
    }

    try {
      window.localStorage.setItem(FILTER_STORAGE_KEY, filter);
    } catch {
      // Ignore localStorage failures (private mode, blocked storage)
    }
  }, [filter, hasHydratedPreferences]);

  const refreshTodos = useCallback(
    async (showLoading = false) => {
      if (!isAuthenticated) {
        return;
      }

      if (showLoading) {
        setIsLoadingTodos(true);
      }

      try {
        const { todos: nextTodos } = await apiClient.listAllTodos();
        setTodos(sortTodos(nextTodos));
        setHasLoadedTodos(true);
      } catch (error) {
        toast.error(parseErrorMessage(error));
      } finally {
        if (showLoading) {
          setIsLoadingTodos(false);
        }
      }
    },
    [isAuthenticated],
  );

  const refreshQueuedPromptCount = useCallback(async () => {
    try {
      const queue = await listQueuedPrompts();
      setQueuedPromptCount(queue.length);
    } catch {
      // Ignore queue read failures to keep UI responsive.
    }
  }, []);

  const queuePrompt = useCallback(
    async (text: string, source: "app" | "shortcut") => {
      const cleanInput = text.trim().slice(0, 8_000);
      if (!cleanInput) {
        return null;
      }

      const queued = await addQueuedPrompt({
        text: cleanInput,
        source,
      });
      setQueuedPromptCount((previous) => previous + 1);
      return queued.id;
    },
    [],
  );

  const flushQueuedPrompts = useCallback(async () => {
    if (!isAuthenticated || !isOnline || isQueueFlushRunning.current) {
      return;
    }

    isQueueFlushRunning.current = true;
    setIsProcessingQueue(true);

    try {
      const queue = await listQueuedPrompts();
      setQueuedPromptCount(queue.length);

      if (queue.length === 0) {
        return;
      }

      let createdTodos = 0;
      let failedItems = 0;

      for (const item of queue) {
        const nextAttempts = item.attempts + 1;
        await patchQueuedPrompt(item.id, {
          status: "processing",
          attempts: nextAttempts,
          lastError: null,
        });

        try {
          const result = await apiClient.generateTodosFromInput(item.text);
          createdTodos += result.created;
          await removeQueuedPrompt(item.id);
        } catch (error) {
          failedItems += 1;
          await patchQueuedPrompt(item.id, {
            status: "failed",
            attempts: nextAttempts,
            lastError: parseErrorMessage(error),
          });
        }
      }

      await refreshQueuedPromptCount();

      if (createdTodos > 0) {
        toast.message(`generated ${createdTodos} queued todos`);
      }

      if (failedItems > 0) {
        toast.error(
          `${failedItems} queued item${failedItems === 1 ? "" : "s"} failed`,
        );
      }

      await refreshTodos();
    } finally {
      isQueueFlushRunning.current = false;
      setIsProcessingQueue(false);
    }
  }, [isAuthenticated, isOnline, refreshQueuedPromptCount, refreshTodos]);

  useEffect(() => {
    void refreshTodos(true);
  }, [refreshTodos]);

  useEffect(() => {
    void refreshQueuedPromptCount();
  }, [refreshQueuedPromptCount]);

  useEffect(() => {
    if (!isAuthenticated || !isOnline) {
      return;
    }

    void flushQueuedPrompts();
  }, [flushQueuedPrompts, isAuthenticated, isOnline]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCurrentTimestamp(Date.now());
    }, 30_000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshTodos();
      void flushQueuedPrompts();
    }, 20_000);

    return () => window.clearInterval(timer);
  }, [flushQueuedPrompts, isAuthenticated, refreshTodos]);

  const focusPromptInputAtEnd = useCallback(
    (force = false) => {
      if (!promptAutofocus || isGenerating || isProcessingQueue) {
        return;
      }

      const input = promptInputRef.current;
      if (!input) {
        return;
      }

      const activeElement = document.activeElement;
      if (
        !force &&
        activeElement &&
        activeElement !== document.body &&
        activeElement !== input
      ) {
        return;
      }

      input.focus({ preventScroll: true });
      const cursorPosition = input.value.length;
      input.setSelectionRange(cursorPosition, cursorPosition);
    },
    [isGenerating, isProcessingQueue, promptAutofocus],
  );

  useEffect(() => {
    if (!hasHydratedPreferences || !promptAutofocus) {
      return;
    }

    const timer = window.setTimeout(() => {
      focusPromptInputAtEnd(true);
      hasAppliedInitialAutofocus.current = true;
    }, 0);

    return () => window.clearTimeout(timer);
  }, [focusPromptInputAtEnd, hasHydratedPreferences, promptAutofocus]);

  useEffect(() => {
    if (!hasHydratedPreferences || !promptAutofocus) {
      return;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      focusPromptInputAtEnd(!hasAppliedInitialAutofocus.current);
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [
    focusPromptInputAtEnd,
    hasHydratedPreferences,
    promptAutofocus,
    searchParams,
  ]);

  useEffect(() => {
    if (!hasHydratedPreferences) {
      return;
    }

    const viewParam = searchParams.get("view");
    if (!viewParam) {
      setFilter(readStoredFilter());
      return;
    }

    setFilter(normalizeFilter(viewParam));
  }, [hasHydratedPreferences, searchParams]);

  useEffect(() => {
    if (!hasHydratedPreferences) {
      return;
    }

    if (!searchParams.get("view")) {
      const nextFilter = readStoredFilter();
      setFilter(nextFilter);
      const params = new URLSearchParams(searchParams.toString());
      params.set("view", nextFilter);
      router.replace(`/?${params.toString()}`, { scroll: false });
    }
  }, [hasHydratedPreferences, router, searchParams]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    const shortcutText = searchParams.get("shortcut");
    if (!shortcutText) {
      return;
    }

    const captureId = searchParams.get("captureId");
    const dedupeKey = captureId
      ? `${SHORTCUT_CAPTURE_KEY_PREFIX}${captureId}`
      : null;

    const clearShortcutParams = () => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("shortcut");
      params.delete("source");
      params.delete("captureId");
      params.delete("ts");
      if (!params.get("view")) {
        params.set("view", filter);
      }
      router.replace(`/?${params.toString()}`, { scroll: false });
    };

    if (
      dedupeKey &&
      typeof window !== "undefined" &&
      window.sessionStorage.getItem(dedupeKey)
    ) {
      clearShortcutParams();
      return;
    }

    if (dedupeKey && typeof window !== "undefined") {
      window.sessionStorage.setItem(dedupeKey, "1");
    }

    const source =
      searchParams.get("source") === "shortcut" ? "shortcut" : "app";

    void (async () => {
      const queuedId = await queuePrompt(shortcutText, source);
      if (!queuedId) {
        clearShortcutParams();
        return;
      }

      if (isOnline) {
        toast.message("shortcut received. generating todos…");
        await flushQueuedPrompts();
      } else {
        toast.message("shortcut received offline. queued for next connection.");
      }

      clearShortcutParams();
    })();
  }, [
    filter,
    flushQueuedPrompts,
    isAuthenticated,
    isOnline,
    queuePrompt,
    router,
    searchParams,
  ]);

  const setActiveFilter = useCallback(
    (nextFilter: TodoFilter) => {
      setFilter(nextFilter);
      const params = new URLSearchParams(searchParams.toString());
      params.set("view", nextFilter);
      router.replace(`/?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTypingTarget =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        focusPromptInputAtEnd(true);
        return;
      }

      if (isTypingTarget) {
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.shiftKey && event.altKey) {
        if (event.key === "1") {
          event.preventDefault();
          setActiveFilter("today");
          return;
        }

        if (event.key === "2") {
          event.preventDefault();
          setActiveFilter("upcoming");
          return;
        }

        if (event.key === "3") {
          event.preventDefault();
          setActiveFilter("archive");
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusPromptInputAtEnd, setActiveFilter]);

  const handleAuthenticated = () => {
    setIsAuthenticated(true);
    router.refresh();
    toast.message("access granted");
  };

  const handleGenerateTodos = async () => {
    const cleanInput = promptInput.trim();
    if (!cleanInput) {
      return;
    }

    setIsGenerating(true);
    try {
      const queuedId = await queuePrompt(cleanInput, "app");
      if (!queuedId) {
        return;
      }

      setPromptInput("");

      if (!isOnline) {
        toast.message("saved offline. ai will run when connection is back.");
        await refreshQueuedPromptCount();
        return;
      }

      await flushQueuedPrompts();
    } catch (error) {
      toast.error(parseErrorMessage(error));
    } finally {
      setIsGenerating(false);
    }
  };

  const updateTodoStatus = async (todo: TodoItem, checked: boolean) => {
    const nextStatus = checked ? "done" : "open";
    setPendingTodoId(todo.id);
    setTodos((previousTodos) =>
      sortTodos(
        previousTodos.map((item) =>
          item.id === todo.id
            ? {
                ...item,
                status: nextStatus,
              }
            : item,
        ),
      ),
    );

    try {
      await apiClient.updateTodo(todo.id, { status: nextStatus });
      await refreshTodos();
    } catch (error) {
      toast.error(parseErrorMessage(error));
      setTodos((previousTodos) =>
        sortTodos(
          previousTodos.map((item) =>
            item.id === todo.id
              ? {
                  ...item,
                  status: todo.status,
                }
              : item,
          ),
        ),
      );
    } finally {
      setPendingTodoId(null);
    }
  };

  const updateTodoDate = async (todo: TodoItem, nextDate: string) => {
    setPendingTodoId(todo.id);
    try {
      await apiClient.updateTodo(todo.id, {
        dueDate: nextDate.trim() ? nextDate : null,
      });
      await refreshTodos();
    } catch (error) {
      toast.error(parseErrorMessage(error));
    } finally {
      setPendingTodoId(null);
    }
  };

  const updateTodoRecurrence = async (todo: TodoItem, values: string[]) => {
    const nextRecurrence = values[0];
    if (
      nextRecurrence !== "none" &&
      nextRecurrence !== "daily" &&
      nextRecurrence !== "weekly" &&
      nextRecurrence !== "monthly"
    ) {
      return;
    }

    setPendingTodoId(todo.id);
    try {
      await apiClient.updateTodo(todo.id, {
        recurrence: nextRecurrence as TodoRecurrence,
      });
      await refreshTodos();
    } catch (error) {
      toast.error(parseErrorMessage(error));
    } finally {
      setPendingTodoId(null);
    }
  };

  const updateTodoPriority = async (todo: TodoItem, values: string[]) => {
    const nextPriority = values[0];
    if (nextPriority !== "1" && nextPriority !== "2" && nextPriority !== "3") {
      return;
    }

    setPendingTodoId(todo.id);
    try {
      await apiClient.updateTodo(todo.id, {
        priority: Number(nextPriority) as TodoPriority,
      });
      await refreshTodos();
    } catch (error) {
      toast.error(parseErrorMessage(error));
    } finally {
      setPendingTodoId(null);
    }
  };

  const deleteTodo = async (todo: TodoItem) => {
    const shouldDelete = window.confirm(`delete "${todo.title}"?`);
    if (!shouldDelete) {
      return;
    }

    setPendingTodoId(todo.id);
    try {
      await apiClient.deleteTodo(todo.id);
      setEditingTodoId((current) => (current === todo.id ? null : current));
      toast.message("todo deleted");
      await refreshTodos();
    } catch (error) {
      toast.error(parseErrorMessage(error));
    } finally {
      setPendingTodoId(null);
    }
  };

  const groupedTodos = useMemo(() => {
    const todayDateKey = getLocalDateKey(Date.now());
    const openTodos = todos.filter((todo) => todo.status === "open");
    const dueToday = openTodos.filter((todo) =>
      isTodoOnDateKey(todo.dueDate, todayDateKey),
    );
    const todayIds = new Set(dueToday.map((todo) => todo.id));

    return {
      today: dueToday,
      upcoming: openTodos.filter((todo) => !todayIds.has(todo.id)),
      archive: todos.filter((todo) => todo.status === "done"),
    };
  }, [todos]);

  const filteredTodos = useMemo(() => {
    if (filter === "today") {
      return groupedTodos.today;
    }

    if (filter === "upcoming") {
      return groupedTodos.upcoming;
    }

    return groupedTodos.archive;
  }, [filter, groupedTodos]);

  const todoSections = useMemo<TodoSection[]>(() => {
    if (filter === "today") {
      return ([1, 2, 3] as TodoPriority[])
        .map((priority) => ({
          key: `today-p${priority}`,
          label: TODAY_PRIORITY_LABELS[priority],
          todos: filteredTodos.filter(
            (todo) => normalizeTodoPriority(todo.priority) === priority,
          ),
        }))
        .filter((section) => section.todos.length > 0);
    }

    const sectionsByDate = new Map<
      string,
      { dateKey: string | null; todos: TodoItem[] }
    >();

    for (const todo of filteredTodos) {
      const dateKey = getTodoDateKey(todo.dueDate);
      const mapKey = dateKey === null ? "no-date" : String(dateKey);
      const existingSection = sectionsByDate.get(mapKey);
      if (existingSection) {
        existingSection.todos.push(todo);
      } else {
        sectionsByDate.set(mapKey, { dateKey, todos: [todo] });
      }
    }

    return [...sectionsByDate.entries()]
      .sort((left, right) => {
        const leftDate = left[1].dateKey;
        const rightDate = right[1].dateKey;

        if (leftDate === null && rightDate === null) {
          return 0;
        }
        if (leftDate === null) {
          return 1;
        }
        if (rightDate === null) {
          return -1;
        }

        if (leftDate === rightDate) {
          return 0;
        }

        return filter === "upcoming"
          ? leftDate.localeCompare(rightDate)
          : rightDate.localeCompare(leftDate);
      })
      .map(([key, section]) => ({
        key,
        label: formatSectionDateLabel(section.dateKey, filter, Date.now()),
        todos: section.todos,
      }));
  }, [filter, filteredTodos]);

  if (!isAuthenticated) {
    return (
      <>
        <LoginScreen onAuthenticated={handleAuthenticated} />
        <Toaster position="bottom-right" />
      </>
    );
  }

  return (
    <>
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarHeader className="h-12 border-b p-0">
            <div className="flex h-12 items-center justify-between px-3 group-data-[collapsible=icon]:hidden">
              <p className="text-sm">ibx</p>
              <SidebarTrigger size="icon-sm" variant="ghost" />
            </div>
            <div className="hidden h-12 items-center justify-center group-data-[collapsible=icon]:flex">
              <SidebarTrigger size="icon-sm" variant="ghost" />
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>views</SidebarGroupLabel>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={filter === "today"}
                    onClick={() => setActiveFilter("today")}
                    className="group-data-[collapsible=icon]:justify-center"
                  >
                    <span className="group-data-[collapsible=icon]:hidden">
                      today
                    </span>
                    <span className="hidden group-data-[collapsible=icon]:inline">
                      {"\\"}
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={filter === "upcoming"}
                    onClick={() => setActiveFilter("upcoming")}
                    className="group-data-[collapsible=icon]:justify-center"
                  >
                    <span className="group-data-[collapsible=icon]:hidden">
                      upcoming
                    </span>
                    <span className="hidden group-data-[collapsible=icon]:inline">
                      /
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={filter === "archive"}
                    onClick={() => setActiveFilter("archive")}
                    className="group-data-[collapsible=icon]:justify-center"
                  >
                    <span className="group-data-[collapsible=icon]:hidden">
                      archive
                    </span>
                    <span className="hidden group-data-[collapsible=icon]:inline">
                      [
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    render={<Link href="/settings" prefetch={false} />}
                    className="group-data-[collapsible=icon]:justify-center"
                  >
                    <span className="group-data-[collapsible=icon]:hidden">
                      settings
                    </span>
                    <span className="hidden group-data-[collapsible=icon]:inline">
                      ]
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter>
            <p className="px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
              {getLocalStatusLabel(currentTimestamp)}
            </p>
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>

        <SidebarInset className="min-h-dvh flex flex-col">
          <header className="sticky top-0 z-20 flex h-12 items-center border-b bg-background px-4 md:px-6">
            <div className="flex w-full items-center gap-2">
              <SidebarTrigger
                className="md:hidden"
                size="icon-sm"
                variant="ghost"
              />
              <span className="text-muted-foreground">{">"}</span>
              <Input
                ref={promptInputRef}
                value={promptInput}
                onChange={(event) => setPromptInput(event.target.value)}
                placeholder="type once, generate todos"
                autoFocus={promptAutofocus}
                className="h-8 border-0 bg-transparent px-0 shadow-none ring-0 focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleGenerateTodos();
                  }
                }}
                disabled={isGenerating || isProcessingQueue}
              />
              <Button
                size="sm"
                onClick={() => void handleGenerateTodos()}
                disabled={isGenerating || isProcessingQueue}
                title={
                  queuedPromptCount > 0
                    ? `${queuedPromptCount} queued`
                    : undefined
                }
              >
                {isGenerating || isProcessingQueue ? "running..." : "run"}
              </Button>
            </div>
          </header>

          <main className="min-h-0 flex-1 overflow-y-auto py-4">
            {!hasLoadedTodos && isLoadingTodos ? (
              <p className="px-4 text-sm text-muted-foreground md:px-6">
                loading todos…
              </p>
            ) : filteredTodos.length === 0 ? (
              <p className="px-4 text-sm text-muted-foreground md:px-6">
                no todos in this view yet.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {todoSections.map((section) => (
                  <section
                    key={section.key}
                    className={cn(
                      "flex flex-col gap-0",
                      section.label ? "pt-2" : "",
                    )}
                  >
                    {section.label ? (
                      <p className="px-4 pb-2 text-xs text-muted-foreground md:px-6">
                        {section.label}
                      </p>
                    ) : null}
                    {section.todos.map((todo, index) => (
                      <article
                        key={todo.id}
                        className={cn(
                          "relative cursor-pointer overflow-hidden border-b select-none",
                          index === 0 && "border-t",
                          todo.status === "done" &&
                            "bg-neutral-100 dark:bg-neutral-900/90 dark:border-neutral-800",
                        )}
                        onClick={() => {
                          if (suppressNextClickRef.current) {
                            suppressNextClickRef.current = false;
                            return;
                          }

                          setEditingTodoId((currentTodoId) =>
                            currentTodoId === todo.id ? null : todo.id,
                          );
                        }}
                        onPointerDown={(event) => {
                          if (
                            pendingTodoId === todo.id ||
                            isInteractiveTarget(event.target) ||
                            (event.pointerType === "mouse" &&
                              event.button !== 0)
                          ) {
                            return;
                          }

                          cancelHoldInteraction();
                          heldTodoIdRef.current = todo.id;
                          holdStartRef.current = {
                            x: event.clientX,
                            y: event.clientY,
                          };
                          event.currentTarget.setPointerCapture?.(
                            event.pointerId,
                          );
                          setHoldingTodoId(todo.id);
                          holdStartedAtRef.current = performance.now();
                          const animateHoldProgress = () => {
                            if (
                              holdStartedAtRef.current === null ||
                              heldTodoIdRef.current !== todo.id
                            ) {
                              return;
                            }

                            const elapsed =
                              performance.now() - holdStartedAtRef.current;
                            const progress =
                              elapsed <= HOLD_PROGRESS_DELAY_MS
                                ? 0
                                : Math.min(
                                    1,
                                    (elapsed - HOLD_PROGRESS_DELAY_MS) /
                                      HOLD_PROGRESS_SWEEP_MS,
                                  );
                            setHoldProgress(progress);

                            if (progress < 1) {
                              holdAnimationFrameRef.current =
                                window.requestAnimationFrame(
                                  animateHoldProgress,
                                );
                            }
                          };
                          holdAnimationFrameRef.current =
                            window.requestAnimationFrame(animateHoldProgress);
                          holdTimerRef.current = window.setTimeout(() => {
                            suppressNextClickRef.current = true;
                            void updateTodoStatus(todo, todo.status !== "done");
                            clearHoldAnimation();
                            holdStartRef.current = null;
                            heldTodoIdRef.current = null;
                          }, HOLD_TO_TOGGLE_MS);
                        }}
                        onPointerMove={(event) => {
                          if (
                            heldTodoIdRef.current !== todo.id ||
                            !holdStartRef.current
                          ) {
                            return;
                          }

                          const movedX = Math.abs(
                            event.clientX - holdStartRef.current.x,
                          );
                          const movedY = Math.abs(
                            event.clientY - holdStartRef.current.y,
                          );
                          if (
                            movedX > HOLD_MOVE_CANCEL_PX ||
                            movedY > HOLD_MOVE_CANCEL_PX
                          ) {
                            cancelHoldInteraction();
                          }
                        }}
                        onPointerUp={(event) => {
                          event.currentTarget.releasePointerCapture?.(
                            event.pointerId,
                          );
                          cancelHoldInteraction();
                        }}
                        onPointerCancel={(event) => {
                          event.currentTarget.releasePointerCapture?.(
                            event.pointerId,
                          );
                          cancelHoldInteraction();
                        }}
                      >
                        <div
                          className="pointer-events-none absolute inset-y-0 left-0 z-0 overflow-hidden"
                          style={{
                            width: `${holdProgress * 100}%`,
                            opacity: holdingTodoId === todo.id ? 1 : 0,
                          }}
                        >
                          <div className="h-full w-full bg-black/18 dark:bg-white/16" />
                          <div className="absolute inset-y-0 right-0 w-px bg-foreground/45 dark:bg-foreground/60" />
                        </div>
                        <div className="relative z-10 flex flex-col gap-2 px-4 py-3 md:px-6">
                          <div className="flex items-start gap-3">
                            <div className="flex min-w-0 flex-1 flex-col gap-1">
                              <div className="flex items-start justify-between gap-2">
                                <p
                                  className={cn(
                                    "text-sm",
                                    todo.status === "done" &&
                                      "line-through opacity-70",
                                  )}
                                >
                                  {todo.title}
                                </p>
                              </div>
                              {todo.notes ? (
                                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                  <p className="max-w-full break-words">
                                    {expandedNoteIds[todo.id]
                                      ? todo.notes
                                      : getPreviewNotes(todo.notes)}
                                  </p>
                                  {todo.notes.length > NOTE_PREVIEW_LENGTH ? (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-5 px-1 text-[11px] text-muted-foreground hover:text-foreground"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setExpandedNoteIds((current) => ({
                                          ...current,
                                          [todo.id]: !current[todo.id],
                                        }));
                                      }}
                                      onPointerDown={(event) =>
                                        event.stopPropagation()
                                      }
                                    >
                                      {expandedNoteIds[todo.id]
                                        ? "less"
                                        : "more"}
                                    </Button>
                                  ) : null}
                                </div>
                              ) : null}
                              <p className="text-xs text-muted-foreground">
                                {displayPriority(todo.priority)} / due:{" "}
                                {displayDueDate(todo.dueDate)} /{" "}
                                {displayRecurrence(todo.recurrence)}
                              </p>
                            </div>
                          </div>
                          {editingTodoId === todo.id ? (
                            <div
                              className="ml-0 flex flex-col gap-2 sm:flex-row sm:items-center"
                              onClick={(event) => event.stopPropagation()}
                              onPointerDown={(event) => event.stopPropagation()}
                            >
                              <Popover>
                                <PopoverTrigger
                                  render={
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className={cn(
                                        "w-full justify-start sm:w-44",
                                        !todo.dueDate &&
                                          "text-muted-foreground",
                                      )}
                                      disabled={pendingTodoId === todo.id}
                                    />
                                  }
                                >
                                  {displayDateInputValue(todo.dueDate)}
                                </PopoverTrigger>
                                <PopoverContent className="w-auto gap-0 rounded-md bg-background p-1 shadow-none">
                                  <Calendar
                                    className="rounded-sm border border-border"
                                    mode="single"
                                    selected={
                                      todo.dueDate
                                        ? (dateKeyToLocalDate(
                                            getTodoDateKey(todo.dueDate) ?? "",
                                          ) ?? undefined)
                                        : undefined
                                    }
                                    onSelect={(date) =>
                                      void updateTodoDate(
                                        todo,
                                        date ? format(date, "yyyy-MM-dd") : "",
                                      )
                                    }
                                  />
                                </PopoverContent>
                              </Popover>
                              <ToggleGroup
                                multiple={false}
                                value={[String(todo.priority)]}
                                onValueChange={(values) =>
                                  void updateTodoPriority(todo, values)
                                }
                                variant="default"
                                size="sm"
                              >
                                <ToggleGroupItem
                                  value="1"
                                  className="border border-input aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background data-[state=on]:border-foreground data-[state=on]:bg-foreground data-[state=on]:text-background"
                                >
                                  p1
                                </ToggleGroupItem>
                                <ToggleGroupItem
                                  value="2"
                                  className="border border-input aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background data-[state=on]:border-foreground data-[state=on]:bg-foreground data-[state=on]:text-background"
                                >
                                  p2
                                </ToggleGroupItem>
                                <ToggleGroupItem
                                  value="3"
                                  className="border border-input aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background data-[state=on]:border-foreground data-[state=on]:bg-foreground data-[state=on]:text-background"
                                >
                                  p3
                                </ToggleGroupItem>
                              </ToggleGroup>
                              <ToggleGroup
                                multiple={false}
                                value={[todo.recurrence]}
                                onValueChange={(values) =>
                                  void updateTodoRecurrence(todo, values)
                                }
                                variant="default"
                                size="sm"
                              >
                                <ToggleGroupItem
                                  value="none"
                                  className="border border-input aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background data-[state=on]:border-foreground data-[state=on]:bg-foreground data-[state=on]:text-background"
                                >
                                  once
                                </ToggleGroupItem>
                                <ToggleGroupItem
                                  value="daily"
                                  className="border border-input aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background data-[state=on]:border-foreground data-[state=on]:bg-foreground data-[state=on]:text-background"
                                >
                                  daily
                                </ToggleGroupItem>
                                <ToggleGroupItem
                                  value="weekly"
                                  className="border border-input aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background data-[state=on]:border-foreground data-[state=on]:bg-foreground data-[state=on]:text-background"
                                >
                                  weekly
                                </ToggleGroupItem>
                                <ToggleGroupItem
                                  value="monthly"
                                  className="border border-input aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background data-[state=on]:border-foreground data-[state=on]:bg-foreground data-[state=on]:text-background"
                                >
                                  monthly
                                </ToggleGroupItem>
                              </ToggleGroup>
                              <Button
                                type="button"
                                size="sm"
                                disabled={pendingTodoId === todo.id}
                                onClick={() => {
                                  void deleteTodo(todo);
                                }}
                                onPointerDown={(event) =>
                                  event.stopPropagation()
                                }
                              >
                                delete
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </section>
                ))}
              </div>
            )}
          </main>
        </SidebarInset>
      </SidebarProvider>

      <Toaster position="bottom-right" />
    </>
  );
}
