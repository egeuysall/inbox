import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const upsertProfileMemory = mutation({
  args: {
    key: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("memories")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        kind: "profile",
        content: args.content,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("memories", {
      key: args.key,
      kind: "profile",
      content: args.content,
      runExternalId: null,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const addRunMemory = mutation({
  args: {
    runExternalId: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("memories", {
      key: `run:${args.runExternalId}:${now}`,
      kind: "run",
      content: args.content,
      runExternalId: args.runExternalId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const listRecentRunMemories = query({
  args: {
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const safeLimit = Math.max(1, Math.min(args.limit, 30));
    return await ctx.db
      .query("memories")
      .withIndex("by_kind_and_updatedAt", (q) => q.eq("kind", "run"))
      .order("desc")
      .take(safeLimit);
  },
});

