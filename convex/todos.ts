import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const todoStatusValidator = v.union(v.literal("open"), v.literal("done"));
const recurrenceValidator = v.union(
  v.literal("none"),
  v.literal("daily"),
  v.literal("weekly"),
  v.literal("monthly"),
);

function getNextDueDate(currentDueDate: number | null, recurrence: "daily" | "weekly" | "monthly") {
  const base = currentDueDate ? new Date(currentDueDate) : new Date();
  const next = new Date(base);

  if (recurrence === "daily") {
    next.setDate(next.getDate() + 1);
  } else if (recurrence === "weekly") {
    next.setDate(next.getDate() + 7);
  } else {
    next.setMonth(next.getMonth() + 1);
  }

  return next.getTime();
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
        source: v.union(v.literal("ai"), v.literal("manual")),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const insertedIds = [];

    for (const item of args.items) {
      const todoId = await ctx.db.insert("todos", {
        thoughtId: args.thoughtId,
        thoughtExternalId: args.thoughtExternalId,
        title: item.title,
        notes: item.notes,
        status: "open",
        dueDate: item.dueDate,
        recurrence: item.recurrence,
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
    source: v.union(v.literal("ai"), v.literal("manual")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("todos", {
      thoughtId: args.thoughtId,
      thoughtExternalId: args.thoughtExternalId,
      title: args.title,
      notes: args.notes,
      status: "open",
      dueDate: args.dueDate,
      recurrence: args.recurrence,
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

    if (args.status === "done" && existingTodo.recurrence !== "none") {
      const recurrence =
        existingTodo.recurrence === "daily" ||
        existingTodo.recurrence === "weekly" ||
        existingTodo.recurrence === "monthly"
          ? existingTodo.recurrence
          : null;

      if (!recurrence) {
        return args.todoId;
      }

      await ctx.db.insert("todos", {
        thoughtId: existingTodo.thoughtId,
        thoughtExternalId: existingTodo.thoughtExternalId ?? undefined,
        title: existingTodo.title,
        notes: existingTodo.notes,
        status: "open",
        dueDate: getNextDueDate(existingTodo.dueDate ?? null, recurrence),
        recurrence,
        source: existingTodo.source ?? "manual",
        createdAt: Date.now(),
      });
    }

    return args.todoId;
  },
});

export const updateSchedule = mutation({
  args: {
    todoId: v.id("todos"),
    dueDate: v.optional(v.union(v.number(), v.null())),
    recurrence: v.optional(recurrenceValidator),
  },
  handler: async (ctx, args) => {
    const patch: {
      dueDate?: number | null;
      recurrence?: "none" | "daily" | "weekly" | "monthly";
    } = {};

    if (args.dueDate !== undefined) {
      patch.dueDate = args.dueDate;
    }

    if (args.recurrence !== undefined) {
      patch.recurrence = args.recurrence;
    }

    await ctx.db.patch(args.todoId, patch);
    return args.todoId;
  },
});
