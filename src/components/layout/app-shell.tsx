"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { toast } from "sonner";

import { LoginScreen } from "@/components/auth/login-screen";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useTheme } from "@/hooks/useTheme";
import { apiClient, ApiError } from "@/lib/apiClient";
import type { TodoItem, TodoRecurrence } from "@/lib/types";

type AppShellProps = {
  initialAuthenticated: boolean;
};

function formatDateInput(timestamp: number | null) {
  if (!timestamp) {
    return "";
  }

  return format(new Date(timestamp), "yyyy-MM-dd");
}

function displayDueDate(timestamp: number | null) {
  if (!timestamp) {
    return "no date";
  }

  return format(new Date(timestamp), "MMM d, yyyy");
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

function sortTodos(todos: TodoItem[]) {
  return [...todos].sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === "open" ? -1 : 1;
    }

    const aDueDate = a.dueDate ?? Number.MAX_SAFE_INTEGER;
    const bDueDate = b.dueDate ?? Number.MAX_SAFE_INTEGER;

    if (aDueDate !== bDueDate) {
      return aDueDate - bDueDate;
    }

    return b.createdAt - a.createdAt;
  });
}

export function AppShell({ initialAuthenticated }: AppShellProps) {
  const router = useRouter();
  useTheme();

  const [isAuthenticated, setIsAuthenticated] = useState(initialAuthenticated);
  const [promptInput, setPromptInput] = useState("");
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [isLoadingTodos, setIsLoadingTodos] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [pendingTodoId, setPendingTodoId] = useState<string | null>(null);

  const refreshTodos = useCallback(async () => {
    if (!isAuthenticated) {
      return;
    }

    setIsLoadingTodos(true);
    try {
      const { todos: nextTodos } = await apiClient.listAllTodos();
      setTodos(sortTodos(nextTodos));
    } catch (error) {
      toast.error(parseErrorMessage(error));
    } finally {
      setIsLoadingTodos(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    void refreshTodos();
  }, [refreshTodos]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshTodos();
    }, 20_000);

    return () => window.clearInterval(timer);
  }, [isAuthenticated, refreshTodos]);

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
      const result = await apiClient.generateTodosFromInput(cleanInput);
      setPromptInput("");
      toast.message(`generated ${result.created} todos`);
      await refreshTodos();
    } catch (error) {
      toast.error(parseErrorMessage(error));
    } finally {
      setIsGenerating(false);
    }
  };

  const updateTodoStatus = async (todo: TodoItem) => {
    const nextStatus = todo.status === "open" ? "done" : "open";

    setPendingTodoId(todo.id);
    try {
      await apiClient.updateTodo(todo.id, { status: nextStatus });
      await refreshTodos();
    } catch (error) {
      toast.error(parseErrorMessage(error));
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

  const groupedTodos = useMemo(() => {
    return {
      open: todos.filter((todo) => todo.status === "open"),
      done: todos.filter((todo) => todo.status === "done"),
    };
  }, [todos]);

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
      <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 py-4 md:px-6">
        <header className="flex items-center justify-between border-b pb-3">
          <div className="flex items-baseline gap-2">
            <p className="text-sm tracking-tight">Todos</p>
            <span className="text-xs text-muted-foreground">{format(new Date(), "EEE, MMM d")}</span>
          </div>
          <Button variant="ghost" size="sm" render={<Link href="/settings" prefetch={false} />}>
            settings
          </Button>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto py-4">
          {isLoadingTodos ? (
            <p className="text-xs text-muted-foreground">loading todos…</p>
          ) : (
            <div className="flex flex-col gap-6">
              <section className="flex flex-col gap-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  open ({groupedTodos.open.length})
                </p>
                {groupedTodos.open.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No open todos yet.</p>
                ) : (
                  groupedTodos.open.map((todo) => (
                    <article key={todo.id} className="flex flex-col gap-2 border-b pb-4">
                      <div className="flex items-start gap-3">
                        <Switch
                          checked={todo.status === "done"}
                          onCheckedChange={() => void updateTodoStatus(todo)}
                          aria-label={`Toggle ${todo.title}`}
                          disabled={pendingTodoId === todo.id}
                        />
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <p className="text-sm">{todo.title}</p>
                          {todo.notes ? (
                            <p className="text-xs text-muted-foreground">{todo.notes}</p>
                          ) : null}
                          <p className="text-xs text-muted-foreground">
                            due: {displayDueDate(todo.dueDate)}
                          </p>
                        </div>
                      </div>
                      <div className="ml-8 flex flex-col gap-2 sm:flex-row sm:items-center">
                        <Input
                          type="date"
                          className="w-full sm:w-44"
                          value={formatDateInput(todo.dueDate)}
                          onChange={(event) => void updateTodoDate(todo, event.target.value)}
                          disabled={pendingTodoId === todo.id}
                        />
                        <ToggleGroup
                          multiple={false}
                          value={[todo.recurrence]}
                          onValueChange={(values) => void updateTodoRecurrence(todo, values)}
                          variant="outline"
                          size="sm"
                        >
                          <ToggleGroupItem value="none">once</ToggleGroupItem>
                          <ToggleGroupItem value="daily">daily</ToggleGroupItem>
                          <ToggleGroupItem value="weekly">weekly</ToggleGroupItem>
                          <ToggleGroupItem value="monthly">monthly</ToggleGroupItem>
                        </ToggleGroup>
                      </div>
                    </article>
                  ))
                )}
              </section>

              <section className="flex flex-col gap-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  done ({groupedTodos.done.length})
                </p>
                {groupedTodos.done.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No completed todos yet.</p>
                ) : (
                  groupedTodos.done.map((todo) => (
                    <article key={todo.id} className="flex items-start gap-3 border-b pb-3 opacity-75">
                      <Switch
                        checked={todo.status === "done"}
                        onCheckedChange={() => void updateTodoStatus(todo)}
                        aria-label={`Toggle ${todo.title}`}
                        disabled={pendingTodoId === todo.id}
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <p className="text-sm line-through">{todo.title}</p>
                        {todo.notes ? (
                          <p className="text-xs text-muted-foreground">{todo.notes}</p>
                        ) : null}
                      </div>
                    </article>
                  ))
                )}
              </section>
            </div>
          )}
        </main>

        <footer className="border-t pt-3">
          <div className="flex items-center gap-2">
            <Input
              value={promptInput}
              onChange={(event) => setPromptInput(event.target.value)}
              placeholder="> write one messy thought, then generate todos"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleGenerateTodos();
                }
              }}
              disabled={isGenerating}
            />
            <Button size="sm" onClick={() => void handleGenerateTodos()} disabled={isGenerating}>
              {isGenerating ? "running..." : "run"}
            </Button>
          </div>
        </footer>
      </div>

      <Toaster position="bottom-right" />
    </>
  );
}

