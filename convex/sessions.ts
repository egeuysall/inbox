import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const upsert = mutation({
  args: {
    tokenHash: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("sessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        expiresAt: args.expiresAt,
        lastSeenAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("sessions", {
      tokenHash: args.tokenHash,
      createdAt: now,
      expiresAt: args.expiresAt,
      lastSeenAt: now,
    });
  },
});

export const getValid = query({
  args: {
    tokenHash: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();

    if (!session || session.expiresAt <= Date.now()) {
      return null;
    }

    return {
      _id: session._id,
      expiresAt: session.expiresAt,
    };
  },
});

export const touch = mutation({
  args: {
    tokenHash: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();

    if (!session) {
      return null;
    }

    await ctx.db.patch(session._id, { lastSeenAt: Date.now() });
    return session._id;
  },
});

export const remove = mutation({
  args: {
    tokenHash: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();

    if (!session) {
      return null;
    }

    await ctx.db.delete(session._id);
    return session._id;
  },
});
