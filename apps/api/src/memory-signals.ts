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
        relationships: extracted.relationships,
        tags: extracted.tags,
      },
    },
  };
}

export function extractMemorySignals(content: string) {
  const entityIds = new Set<string>();
  const tags = new Set<string>();
  const relationships = new Map<string, ExtractedRelationship>();

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

  for (const relationship of extractRelationships(content)) {
    entityIds.add(relationship.sourceEntityId);
    entityIds.add(relationship.targetEntityId);
    relationships.set(
      `${relationship.sourceEntityId}:${relationship.relationship}:${relationship.targetEntityId}`,
      relationship,
    );
  }

  return {
    entityIds: [...entityIds].slice(0, 30),
    relationships: [...relationships.values()].slice(0, 20),
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

function extractRelationships(content: string) {
  const relationships: ExtractedRelationship[] = [];
  for (const pattern of RELATIONSHIP_PATTERNS) {
    for (const match of content.matchAll(pattern.regex)) {
      const source = stripLeadingCommonTitleWords((match[1] ?? "").trim());
      const target = stripLeadingCommonTitleWords((match[2] ?? "").trim());
      const sourceEntityId = entityId(source);
      const targetEntityId = entityId(target);
      if (
        sourceEntityId &&
        targetEntityId &&
        sourceEntityId !== targetEntityId
      ) {
        relationships.push({
          source,
          sourceEntityId,
          target,
          targetEntityId,
          relationship: pattern.relationship,
        });
      }
    }
  }
  return relationships;
}

export type ExtractedRelationship = {
  source: string;
  sourceEntityId: string;
  target: string;
  targetEntityId: string;
  relationship:
    | "blocks"
    | "depends_on"
    | "extends"
    | "improves"
    | "replaces"
    | "supports"
    | "uses";
};

const ENTITY_PHRASE = String.raw`([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){0,4}|[A-Z]{2,})`;

const RELATIONSHIP_PATTERNS: Array<{
  relationship: ExtractedRelationship["relationship"];
  regex: RegExp;
}> = [
  {
    relationship: "depends_on",
    regex: new RegExp(
      `${ENTITY_PHRASE}\\s+(?:depends on|needs|requires)\\s+${ENTITY_PHRASE}`,
      "g",
    ),
  },
  {
    relationship: "supports",
    regex: new RegExp(
      `${ENTITY_PHRASE}\\s+(?:supports|enables|backs)\\s+${ENTITY_PHRASE}`,
      "g",
    ),
  },
  {
    relationship: "blocks",
    regex: new RegExp(
      `${ENTITY_PHRASE}\\s+(?:blocks|prevents)\\s+${ENTITY_PHRASE}`,
      "g",
    ),
  },
  {
    relationship: "replaces",
    regex: new RegExp(
      `${ENTITY_PHRASE}\\s+(?:replaces|supersedes)\\s+${ENTITY_PHRASE}`,
      "g",
    ),
  },
  {
    relationship: "extends",
    regex: new RegExp(
      `${ENTITY_PHRASE}\\s+(?:extends|builds on)\\s+${ENTITY_PHRASE}`,
      "g",
    ),
  },
  {
    relationship: "uses",
    regex: new RegExp(
      `${ENTITY_PHRASE}\\s+(?:uses|calls)\\s+${ENTITY_PHRASE}`,
      "g",
    ),
  },
  {
    relationship: "improves",
    regex: new RegExp(
      `${ENTITY_PHRASE}\\s+(?:improves|optimizes)\\s+${ENTITY_PHRASE}`,
      "g",
    ),
  },
];

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
