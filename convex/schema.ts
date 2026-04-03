import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  sessions: defineTable({
    tokenHash: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    lastSeenAt: v.number(),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_expiresAt", ["expiresAt"]),
  thoughts: defineTable({
    externalId: v.string(),
    rawText: v.string(),
    createdAt: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("done"),
      v.literal("failed"),
    ),
    synced: v.boolean(),
    aiRunId: v.union(v.string(), v.null()),
  })
    .index("by_externalId", ["externalId"])
    .index("by_createdAt", ["createdAt"]),
  todos: defineTable({
    thoughtId: v.id("thoughts"),
    thoughtExternalId: v.optional(v.string()),
    title: v.string(),
    notes: v.union(v.string(), v.null()),
    status: v.union(v.literal("open"), v.literal("done")),
    dueDate: v.optional(v.union(v.number(), v.null())),
    recurrence: v.optional(
      v.union(
        v.literal("none"),
        v.literal("daily"),
        v.literal("weekly"),
        v.literal("monthly"),
      ),
    ),
    source: v.optional(v.union(v.literal("ai"), v.literal("manual"))),
    createdAt: v.number(),
  })
    .index("by_thoughtId_and_createdAt", ["thoughtId", "createdAt"])
    .index("by_createdAt", ["createdAt"]),
  memories: defineTable({
    key: v.string(),
    kind: v.union(v.literal("profile"), v.literal("run")),
    content: v.string(),
    runExternalId: v.union(v.string(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_kind_and_updatedAt", ["kind", "updatedAt"])
    .index("by_updatedAt", ["updatedAt"]),
});
