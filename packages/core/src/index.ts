import { z } from "zod";

export const MemoryMetadataSchema = z.record(z.unknown()).default({});

export const MemoryTypeSchema = z.enum([
  "fact",
  "preference",
  "decision",
  "episode",
  "insight",
  "profile",
]);

export const MemoryStatusSchema = z.enum([
  "active",
  "superseded",
  "forgotten",
  "archived",
]);

export const CreateMemorySchema = z.object({
  content: z.string().min(1).max(200_000),
  source: z.string().min(1).max(120).default("api"),
  conversationId: z.string().min(1).max(200).optional(),
  tags: z.array(z.string().min(1).max(80)).max(50).default([]),
  metadata: MemoryMetadataSchema,
  type: MemoryTypeSchema.default("fact"),
  confidence: z.number().min(0).max(1).default(0.8),
  importance: z.number().min(0).max(1).default(0.5),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional(),
  entityIds: z.array(z.string().min(1).max(160)).max(50).default([]),
});

export const SearchSchema = z.object({
  q: z.string().min(1).max(4_000),
  limit: z.number().int().min(1).max(50).default(10),
  tags: z.array(z.string().min(1).max(80)).max(50).default([]),
  includeHistorical: z.boolean().default(false),
  includeForgotten: z.boolean().default(false),
  now: z.string().datetime().optional(),
});

export const GraphEdgeSchema = z.object({
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  relationship: z.string().min(1).max(80),
  weight: z.number().min(0).max(1).default(1),
  metadata: MemoryMetadataSchema,
});

export const UpdateMemorySchema = z.object({
  content: z.string().min(1).max(200_000),
  relationship: z.enum(["updates", "extends", "derives"]).default("updates"),
  source: z.string().min(1).max(120).default("api"),
  tags: z.array(z.string().min(1).max(80)).max(50).optional(),
  metadata: MemoryMetadataSchema,
  confidence: z.number().min(0).max(1).optional(),
  importance: z.number().min(0).max(1).optional(),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional(),
});

export const ForgetMemorySchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});

export const ContextSchema = z.object({
  q: z.string().min(1).max(4_000),
  limit: z.number().int().min(1).max(30).default(8),
  includeProfile: z.boolean().default(true),
  includeHistorical: z.boolean().default(false),
});

export type CreateMemoryInput = z.infer<typeof CreateMemorySchema>;
export type SearchInput = z.infer<typeof SearchSchema>;
export type GraphEdgeInput = z.infer<typeof GraphEdgeSchema>;
export type UpdateMemoryInput = z.infer<typeof UpdateMemorySchema>;
export type ForgetMemoryInput = z.infer<typeof ForgetMemorySchema>;
export type ContextInput = z.infer<typeof ContextSchema>;
export type MemoryType = z.infer<typeof MemoryTypeSchema>;
export type MemoryStatus = z.infer<typeof MemoryStatusSchema>;

export type MemoryRecord = {
  id: string;
  content: string;
  source: string;
  conversationId?: string;
  tags: string[];
  metadata: Record<string, unknown>;
  type: MemoryType;
  status: MemoryStatus;
  isLatest: boolean;
  confidence: number;
  importance: number;
  validFrom?: string;
  validUntil?: string;
  supersedesId?: string;
  entityIds: string[];
  forgottenAt?: string;
  forgetReason?: string;
  createdAt: string;
  updatedAt: string;
};

export type SearchResult = MemoryRecord & {
  score: number;
  reason: "semantic" | "keyword";
};

export const createMemoryId = () => `mem_${crypto.randomUUID()}`;

export const normalizeTenantId = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .slice(0, 120);
