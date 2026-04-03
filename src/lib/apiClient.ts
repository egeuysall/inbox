import type {
  SyncThoughtInput,
  ThoughtRecord,
  TodoItem,
  TodoRecurrence,
  TodoStatus,
} from "@/lib/types";

type ApiErrorPayload = { error?: string };

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function requestJson<T>(input: string, init?: RequestInit) {
  const response = await fetch(input, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const json = (await response.json().catch(() => ({}))) as T & ApiErrorPayload;

  if (!response.ok) {
    throw new ApiError(json.error || "Request failed.", response.status);
  }

  return json as T;
}

export const apiClient = {
  async login(password: string) {
    return requestJson<{ ok: true }>("/api/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
  },

  async logout() {
    return requestJson<{ ok: true }>("/api/logout", { method: "POST" });
  },

  async session() {
    return requestJson<{ authenticated: boolean; expiresAt: number | null }>(
      "/api/session",
      { method: "GET" },
    );
  },

  async listThoughts() {
    return requestJson<{ thoughts: ThoughtRecord[] }>("/api/thoughts", {
      method: "GET",
    });
  },

  async syncThoughts(thoughts: SyncThoughtInput[]) {
    return requestJson<{ thoughts: ThoughtRecord[] }>("/api/thoughts/sync", {
      method: "POST",
      body: JSON.stringify({ thoughts }),
    });
  },

  async listTodos(externalId: string) {
    return requestJson<{ todos: TodoItem[] }>(`/api/thoughts/${externalId}/todos`, {
      method: "GET",
    });
  },

  async createTodo(externalId: string, title: string, notes: string | null) {
    return requestJson<{ ok: true }>(`/api/thoughts/${externalId}/todos`, {
      method: "POST",
      body: JSON.stringify({ title, notes }),
    });
  },

  async generateTodos(externalId: string) {
    return requestJson<{ ok: true; created: number }>(
      `/api/thoughts/${externalId}/generate`,
      {
        method: "POST",
      },
    );
  },

  async listAllTodos() {
    return requestJson<{ todos: TodoItem[] }>("/api/todos", {
      method: "GET",
    });
  },

  async generateTodosFromInput(text: string) {
    return requestJson<{ ok: true; runId: string; created: number }>("/api/todos/generate", {
      method: "POST",
      body: JSON.stringify({ text }),
    });
  },

  async updateTodo(
    todoId: string,
    payload: {
      status?: TodoStatus;
      dueDate?: string | null;
      recurrence?: TodoRecurrence;
    },
  ) {
    return requestJson<{ ok: true }>(`/api/todos/${todoId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
};
