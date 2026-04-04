import type {
  SyncThoughtInput,
  ThoughtRecord,
  TodoItem,
  TodoPriority,
  TodoRecurrence,
  TodoStatus,
} from "@/lib/types";

type ApiErrorPayload = { error?: string };

function getLocalDateKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

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
    const today = getLocalDateKey();
    return requestJson<{ todos: TodoItem[] }>(`/api/thoughts/${externalId}/todos?today=${today}`, {
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
    const today = getLocalDateKey();
    return requestJson<{ ok: true; created: number }>(
      `/api/thoughts/${externalId}/generate`,
      {
        method: "POST",
        body: JSON.stringify({ today }),
      },
    );
  },

  async listAllTodos() {
    const today = getLocalDateKey();
    return requestJson<{ todos: TodoItem[] }>(`/api/todos?today=${today}`, {
      method: "GET",
    });
  },

  async generateTodosFromInput(text: string) {
    const today = getLocalDateKey();
    return requestJson<{ ok: true; runId: string; created: number }>("/api/todos/generate", {
      method: "POST",
      body: JSON.stringify({ text, today }),
    });
  },

  async listApiKeys() {
    return requestJson<{
      keys: Array<{
        id: string;
        name: string;
        prefix: string;
        last4: string;
        createdAt: number;
      }>;
    }>("/api/api-keys", {
      method: "GET",
    });
  },

  async createApiKey(name: string) {
    return requestJson<{
      ok: true;
      apiKey: string;
      key: {
        id: string;
        name: string;
        prefix: string;
        last4: string;
      };
    }>("/api/api-keys", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  },

  async revokeApiKey(keyId: string) {
    return requestJson<{ ok: true }>(`/api/api-keys/${keyId}`, {
      method: "DELETE",
    });
  },

  async updateTodo(
    todoId: string,
    payload: {
      status?: TodoStatus;
      dueDate?: string | null;
      recurrence?: TodoRecurrence;
      priority?: TodoPriority;
    },
  ) {
    return requestJson<{ ok: true }>(`/api/todos/${todoId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },

  async deleteTodo(todoId: string) {
    return requestJson<{ ok: true }>(`/api/todos/${todoId}`, {
      method: "DELETE",
    });
  },
};
