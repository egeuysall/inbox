import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const thoughtStatusValidator = v.union(
  v.literal("pending"),
  v.literal("processing"),
  v.literal("done"),
  v.literal("failed"),
);

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("thoughts").withIndex("by_createdAt").order("desc").take(200);
  },
});

export const getByExternalId = query({
  args: {
    externalId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("thoughts")
      .withIndex("by_externalId", (q) => q.eq("externalId", args.externalId))
      .unique();
  },
});

export const upsert = mutation({
  args: {
    externalId: v.string(),
    rawText: v.string(),
    createdAt: v.number(),
    status: thoughtStatusValidator,
    synced: v.boolean(),
    aiRunId: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("thoughts")
      .withIndex("by_externalId", (q) => q.eq("externalId", args.externalId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        rawText: args.rawText,
        status: args.status,
        synced: args.synced,
        aiRunId: args.aiRunId,
      });
      return existing._id;
    }

    return await ctx.db.insert("thoughts", args);
  },
});

export const updateStatus = mutation({
  args: {
    externalId: v.string(),
    status: thoughtStatusValidator,
    aiRunId: v.optional(v.union(v.string(), v.null())),
    synced: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const thought = await ctx.db
      .query("thoughts")
      .withIndex("by_externalId", (q) => q.eq("externalId", args.externalId))
      .unique();

    if (!thought) {
      return null;
    }

    await ctx.db.patch(thought._id, {
      status: args.status,
      aiRunId: args.aiRunId ?? thought.aiRunId,
      synced: args.synced ?? thought.synced,
    });

    return thought._id;
  },
});
