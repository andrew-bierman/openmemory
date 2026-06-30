export function enrichMemoryInput<
  T extends {
    content?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
    entityIds?: string[];
  },
>(input: T) {
  if (!input.content) {
    return input;
  }

  const extracted = extractMemorySignals(input.content);
  return {
    ...input,
    tags: mergeUnique([...(input.tags ?? []), ...extracted.tags]),
    entityIds: mergeUnique([
      ...(input.entityIds ?? []),
      ...extracted.entityIds,
    ]),
    metadata: {
      ...(input.metadata ?? {}),
      extraction: {
        strategy: "deterministic-v1",
        entityIds: extracted.entityIds,
        tags: extracted.tags,
      },
    },
  };
}

export function extractMemorySignals(content: string) {
  const entityIds = new Set<string>();
  const tags = new Set<string>();

  for (const match of content.matchAll(
    /\b[A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+){0,3}\b/g,
  )) {
    if (match.index && content[match.index - 1] === "#") {
      continue;
    }

    const value = stripLeadingCommonTitleWords(match[0].trim());
    if (value.length >= 3 && !COMMON_TITLE_WORDS.has(value)) {
      entityIds.add(entityId(value));
    }
  }

  for (const match of content.matchAll(/\b[A-Z]{2,}\b/g)) {
    entityIds.add(entityId(match[0]));
  }

  for (const match of content.matchAll(/#([a-zA-Z0-9_-]{2,40})/g)) {
    tags.add(match[1].toLowerCase());
  }

  for (const term of tokenizeContent(content)) {
    if (DOMAIN_TAGS.has(term)) {
      tags.add(term);
    }
  }

  return {
    entityIds: [...entityIds].slice(0, 30),
    tags: [...tags].slice(0, 20),
  };
}

export function mergeUnique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function entityId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
}

function tokenizeContent(content: string) {
  return content
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function stripLeadingCommonTitleWords(value: string) {
  const words = value.split(/\s+/);
  while (words.length > 1 && COMMON_TITLE_WORDS.has(words[0] ?? "")) {
    words.shift();
  }
  return words.join(" ");
}

const COMMON_TITLE_WORDS = new Set([
  "The",
  "This",
  "That",
  "When",
  "Where",
  "OpenMemory",
]);

const DOMAIN_TAGS = new Set([
  "api",
  "auth",
  "cloudflare",
  "durable",
  "graph",
  "mcp",
  "memory",
  "oauth",
  "rag",
  "vectorize",
]);
