import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const todoStatusValidator = v.union(v.literal("open"), v.literal("done"));
const recurrenceValidator = v.union(
  v.literal("none"),
  v.literal("daily"),
  v.literal("weekly"),
  v.literal("monthly"),
);
const priorityValidator = v.union(v.literal(1), v.literal(2), v.literal(3));
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TODOS_TODAY = 30;

function getStartOfUtcDay(timestamp: number) {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function isDueTodayUtc(timestamp: number | null | undefined, todayStartUtc: number) {
  if (typeof timestamp !== "number") {
    return false;
  }

  return timestamp >= todayStartUtc && timestamp < todayStartUtc + DAY_MS;
}

function getNextRecurringDueDate(
  recurrence: "daily" | "weekly" | "monthly",
  dueDate: number | null | undefined,
  now: number,
) {
  const todayStartUtc = getStartOfUtcDay(now);
  const baseDueDate =
    typeof dueDate === "number" ? Math.max(dueDate, todayStartUtc) : todayStartUtc;

  if (recurrence === "daily") {
    return baseDueDate + DAY_MS;
  }

  if (recurrence === "weekly") {
    return baseDueDate + 7 * DAY_MS;
  }

  const date = new Date(baseDueDate);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export const byThought = query({
  args: {
    thoughtId: v.id("thoughts"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("todos")
      .withIndex("by_thoughtId_and_createdAt", (q) => q.eq("thoughtId", args.thoughtId))
      .order("desc")
      .take(300);
  },
});

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("todos").withIndex("by_createdAt").order("desc").take(500);
  },
});

export const enforceDueDatesAndReschedule = mutation({
  args: {
    todayStartUtc: v.number(),
  },
  handler: async (ctx, args) => {
    const todos = await ctx.db.query("todos").withIndex("by_createdAt").order("desc").take(500);
    let updated = 0;
    const normalizedOpenTodos: Array<{
      _id: (typeof todos)[number]["_id"];
      dueDate: number;
      priority: 1 | 2 | 3;
      createdAt: number;
    }> = [];

    for (const todo of todos) {
      let nextDueDate = typeof todo.dueDate === "number" ? todo.dueDate : args.todayStartUtc;
      const nextPriority = todo.priority === 1 || todo.priority === 3 ? todo.priority : 2;

      if (typeof todo.dueDate !== "number") {
        await ctx.db.patch(todo._id, { dueDate: nextDueDate, priority: nextPriority });
        updated += 1;
      } else if (todo.priority !== 1 && todo.priority !== 2 && todo.priority !== 3) {
        await ctx.db.patch(todo._id, { priority: nextPriority });
        updated += 1;
      }

      const isOverdueOpen = todo.status === "open" && nextDueDate < args.todayStartUtc;

      if (isOverdueOpen) {
        nextDueDate = args.todayStartUtc;
        await ctx.db.patch(todo._id, { dueDate: nextDueDate });
        updated += 1;
      }

      if (todo.status === "open") {
        normalizedOpenTodos.push({
          _id: todo._id,
          dueDate: nextDueDate,
          priority: nextPriority,
          createdAt: todo.createdAt,
        });
      }
    }

    const openDueToday = normalizedOpenTodos
      .filter((todo) => isDueTodayUtc(todo.dueDate, args.todayStartUtc))
      .sort((left, right) => {
        if (left.priority !== right.priority) {
          return left.priority - right.priority;
        }

        return left.createdAt - right.createdAt;
      });

    const overflowTodos = openDueToday.slice(MAX_TODOS_TODAY);
    for (const [index, todo] of overflowTodos.entries()) {
      const nextDueDate = args.todayStartUtc + (index + 1) * DAY_MS;
      await ctx.db.patch(todo._id, { dueDate: nextDueDate });
      updated += 1;
    }

    return { updated };
  },
});

export const createMany = mutation({
  args: {
    thoughtId: v.id("thoughts"),
    thoughtExternalId: v.string(),
    items: v.array(
      v.object({
        title: v.string(),
        notes: v.union(v.string(), v.null()),
        dueDate: v.union(v.number(), v.null()),
        recurrence: recurrenceValidator,
        priority: priorityValidator,
        source: v.union(v.literal("ai"), v.literal("manual")),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const todayStartUtc = getStartOfUtcDay(now);
    const insertedIds = [];

    for (const item of args.items) {
      const todoId = await ctx.db.insert("todos", {
        thoughtId: args.thoughtId,
        thoughtExternalId: args.thoughtExternalId,
        title: item.title,
        notes: item.notes,
        status: "open",
        dueDate: item.dueDate ?? todayStartUtc,
        recurrence: item.recurrence,
        priority: item.priority,
        source: item.source,
        createdAt: now,
      });
      insertedIds.push(todoId);
    }

    return insertedIds;
  },
});

export const createOne = mutation({
  args: {
    thoughtId: v.id("thoughts"),
    thoughtExternalId: v.string(),
    title: v.string(),
    notes: v.union(v.string(), v.null()),
    dueDate: v.union(v.number(), v.null()),
    recurrence: recurrenceValidator,
    priority: v.optional(priorityValidator),
    source: v.union(v.literal("ai"), v.literal("manual")),
  },
  handler: async (ctx, args) => {
    const todayStartUtc = getStartOfUtcDay(Date.now());
    return await ctx.db.insert("todos", {
      thoughtId: args.thoughtId,
      thoughtExternalId: args.thoughtExternalId,
      title: args.title,
      notes: args.notes,
      status: "open",
      dueDate: args.dueDate ?? todayStartUtc,
      recurrence: args.recurrence,
      priority: args.priority ?? 2,
      source: args.source,
      createdAt: Date.now(),
    });
  },
});

export const updateStatus = mutation({
  args: {
    todoId: v.id("todos"),
    status: todoStatusValidator,
  },
  handler: async (ctx, args) => {
    const existingTodo = await ctx.db.get(args.todoId);
    if (!existingTodo) {
      return null;
    }

    if (existingTodo.status === args.status) {
      return args.todoId;
    }

    await ctx.db.patch(args.todoId, { status: args.status });

    const isRecurringCompletion =
      args.status === "done" &&
      existingTodo.status === "open" &&
      existingTodo.recurrence &&
      existingTodo.recurrence !== "none";

    if (isRecurringCompletion) {
      const recurrence = existingTodo.recurrence as "daily" | "weekly" | "monthly";
      const now = Date.now();
      const nextDueDate = getNextRecurringDueDate(recurrence, existingTodo.dueDate, now);

      await ctx.db.insert("todos", {
        thoughtId: existingTodo.thoughtId,
        thoughtExternalId: existingTodo.thoughtExternalId,
        title: existingTodo.title,
        notes: existingTodo.notes ?? null,
        status: "open",
        dueDate: nextDueDate,
        recurrence,
        priority:
          existingTodo.priority === 1 || existingTodo.priority === 3 ? existingTodo.priority : 2,
        source: existingTodo.source ?? "manual",
        createdAt: now,
      });
    }

    return args.todoId;
  },
});

export const deleteOne = mutation({
  args: {
    todoId: v.id("todos"),
  },
  handler: async (ctx, args) => {
    const existingTodo = await ctx.db.get(args.todoId);
    if (!existingTodo) {
      return null;
    }

    await ctx.db.delete(args.todoId);
    return args.todoId;
  },
});

export const deleteOneByStringId = mutation({
  args: {
    todoId: v.string(),
  },
  handler: async (ctx, args) => {
    const normalizedTodoId = ctx.db.normalizeId("todos", args.todoId);
    if (!normalizedTodoId) {
      return null;
    }

    const existingTodo = await ctx.db.get(normalizedTodoId);
    if (!existingTodo) {
      return null;
    }

    await ctx.db.delete(normalizedTodoId);
    return normalizedTodoId;
  },
});

export const updateSchedule = mutation({
  args: {
    todoId: v.id("todos"),
    dueDate: v.optional(v.union(v.number(), v.null())),
    recurrence: v.optional(recurrenceValidator),
    priority: v.optional(priorityValidator),
  },
  handler: async (ctx, args) => {
    const patch: {
      dueDate?: number | null;
      recurrence?: "none" | "daily" | "weekly" | "monthly";
      priority?: 1 | 2 | 3;
    } = {};

    const todayStartUtc = getStartOfUtcDay(Date.now());

    if (args.dueDate !== undefined) {
      patch.dueDate = args.dueDate ?? todayStartUtc;
    }

    if (args.recurrence !== undefined) {
      patch.recurrence = args.recurrence;
    }

    if (args.priority !== undefined) {
      patch.priority = args.priority;
    }

    await ctx.db.patch(args.todoId, patch);
    return args.todoId;
  },
});
