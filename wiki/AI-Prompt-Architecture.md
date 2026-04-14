# AI Prompt Architecture

All AI prompts live in `packages/ai-prompts/` as versioned TypeScript files.

---

## File structure

```
packages/ai-prompts/
├── constants.ts                   AI_MODEL, AI_MAX_TOKENS
├── generate-lesson.v1.ts
├── generate-activity.v1.ts
├── generate-rubric.v1.ts
├── adapt-lesson.v1.ts
├── personalised-review.v1.ts
└── suggest-next-lesson.v1.ts
```

One file per capability. The version is part of the filename (`v1`, `v2`, etc.).

---

## File contract

Each file exports a params interface and a `buildPrompt` function:

```typescript
// generate-lesson.v1.ts

export interface GenerateLessonParams {
  topic: string
  cefrLevel: 'a1' | 'a2' | 'b1' | 'b2' | 'c1' | 'c2'
  grammarTargets: string[]
  durationMinutes: number
  studentInterests?: string[]
  targetLanguage: string
  framework: 'cefr' | 'jlpt' | 'hsk' | 'custom'
}

export function buildPrompt(params: GenerateLessonParams): {
  system: string
  user: string
}
```

The `buildPrompt` return value is passed directly to the Anthropic SDK:

```typescript
const { system, user } = buildPrompt(req.body)
anthropic.messages.stream({ model: AI_MODEL, system, messages: [{ role: 'user', content: user }] })
```

---

## System message structure

The system message for each prompt must define:

1. **Output JSON schema** — must match the corresponding DTO in `packages/types` exactly
2. **CEFR level descriptions** — what A1, A2, B1, B2, C1, C2 vocabulary/grammar complexity means
3. **Activity type formats** — the jsonb structure for each activity type (cloze, mcq, etc.)
4. **Answer key structure** — how answers should be provided for validation
5. **Skill tag catalogue** — the accepted values for `skill_tags[]`

Example system message fragment:
```
You are an expert EFL curriculum designer. Generate a complete lesson as valid JSON only.
No markdown fences. No preamble. Output must match this schema exactly:

{
  "title": "string",
  "objective": "string",
  "activities": [
    {
      "type": "cloze" | "mcq" | "matching" | "ordering",
      "title": "string",
      "content": { /* type-specific */ },
      "skill_tags": ["string"],
      "scoring_rules": { "accept_near_match": boolean }
    }
  ]
}

CEFR B1 vocabulary: everyday language, familiar topics, can handle most travel situations...
```

---

## Adding a new capability

1. Create `packages/ai-prompts/{capability}.v1.ts`
2. Export the params interface and `buildPrompt` function
3. Add the capability to the `ai_drafts.capability` enum in `schema.prisma`
4. Add a migration: `pnpm db:migrate --create-only`
5. Add the capability to the `POST /v1/ai/generate` route body validation
6. Update `ai_generation_logs` to accept the new capability enum value

---

## Bumping a prompt version

When making a breaking change to a prompt (new output schema, different parameters):

1. Create a new file: `{capability}.v2.ts`
2. Keep the old `v1` file — existing `ai_drafts` rows reference `prompt_version = '..v1'`
3. Update the route to use `v2` by default
4. Add a migration if the output schema changed (update `ai_drafts.output` validation)

The `ai_drafts.prompt_version` field records which version was used for each draft, allowing reproducibility and debugging.

---

## Constants

```typescript
// packages/ai-prompts/constants.ts

export const AI_MODEL = 'claude-sonnet-4-6'
export const AI_MAX_TOKENS = 4096

// Skill tag catalogue (subset)
export const SKILL_TAGS = [
  'present_simple',
  'present_perfect',
  'past_simple',
  'second_conditional',
  'third_conditional',
  'modal_verbs',
  'irregular_verbs',
  'phrasal_verbs',
  'articles',
  'prepositions',
  // ...
] as const

export type SkillTag = typeof SKILL_TAGS[number]
```
