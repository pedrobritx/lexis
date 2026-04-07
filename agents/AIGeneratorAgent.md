# AIGeneratorAgent

You are building the **AI generation system** for Lexis (`apps/api/src/modules/ai-generator/` and `packages/ai-prompts/`).

## Before you start

Read in this order — all of them:
1. `docs/ai.md` — complete AI specification, SSE streaming, review flow, credit system
2. `docs/schema.md` — ai_drafts, ai_generation_logs, ai_suggestions
3. `docs/billing.md` — credit checking and AI feature gate

## What you are building

6 AI generation capabilities with SSE streaming, teacher draft review + approval flow, next-lesson suggestion system (auto + on-demand), and AI credit tracking.

## Files to create

```
packages/ai-prompts/
  src/constants.ts                  AI_MODEL, AI_MAX_TOKENS
  src/generate-lesson.v1.ts
  src/generate-activity.v1.ts
  src/generate-rubric.v1.ts
  src/adapt-lesson.v1.ts
  src/personalised-review.v1.ts
  src/suggest-next-lesson.v1.ts
  src/index.ts

apps/api/src/modules/ai-generator/
  ai.routes.ts
  ai.service.ts                     Generation orchestration
  draft.service.ts                  Draft storage + review + approve
  suggestion.service.ts             Auto-trigger + on-demand

apps/api/src/workers/
  suggestion.worker.ts              BullMQ job after lesson.completed
```

## Prompt structure requirements

Each prompt file must:
1. Export a typed `Params` interface
2. Export a `buildPrompt(params: Params): { system: string, user: string }` function
3. System message must specify the exact output JSON schema matching the relevant DTO
4. System message must state: "Return ONLY valid JSON. No markdown fences. No preamble."

Example structure for generate-activity:
```typescript
export interface GenerateActivityParams {
  activityType: 'cloze' | 'mcq' | 'matching' | 'ordering'
  grammarTarget: string
  cefrLevel: string
  contextSentence?: string
  targetLanguage: string
}

export function buildPrompt(params: GenerateActivityParams): { system: string; user: string } {
  return {
    system: `You are a language teaching expert...
Output ONLY a JSON object matching this schema:
{
  "title": string,
  "type": "${params.activityType}",
  "content": { /* type-specific structure */ },
  "answer_key": { /* correct answers */ },
  "skill_tags": string[]
}
No markdown. No explanation. JSON only.`,
    user: `Create a ${params.activityType} activity for ${params.cefrLevel} learners...`
  }
}
```

## SSE streaming implementation

See `docs/ai.md` for the complete implementation. Key points:
- Set `Content-Type: text/event-stream` before streaming starts
- Stream each text chunk as `data: {"text": "..."}\n\n`
- On completion, emit `data: {"done": true, "draftId": "..."}\n\n`
- Buffer full text, parse JSON on completion
- On JSON parse failure: retry once with JSON-enforcement suffix
- Always log to `ai_generation_logs` with token usage

## Draft review flow

The draft review is the most important constraint in this module. See `docs/ai.md` for the full flow.

```
POST /v1/ai/generate
  → check feature_flags.ai (403 if false)
  → decrementAiCredit (402 if insufficient)
  → buildPrompt from params
  → stream Anthropic response via SSE
  → on complete: create ai_drafts row (status='pending_review')
  → emit done event with draftId

GET /v1/ai/drafts/:id
  → return draft with output JSON (for teacher to review)

PATCH /v1/ai/drafts/:id
  → update draft output (teacher inline edits)
  → status remains 'pending_review'

POST /v1/ai/drafts/:id/approve
  → validate output JSON matches target DTO
  → create Lesson/Activity/RubricTemplate in course
  → set draft status = 'approved'
  → return created resource

POST /v1/ai/drafts/:id/discard
  → set draft status = 'discarded' (soft-delete effectively)
```

## Next lesson suggestion

### Auto-trigger conditions (all must be true)
1. `lesson.completed` event fired
2. Student has ≥ 3 completed lessons in current unit
3. No `ai_suggestions` row for this student with `created_at > 7 days ago`
4. Last lesson `score_pct >= 0.70`

If all true: enqueue `suggestion.worker` BullMQ job.

### Worker implementation
```typescript
// suggestion.worker.ts
async function processSuggestion({ studentId, tenantId }) {
  const state = await buildStudentContext(studentId, tenantId)
  const { system, user } = buildPrompt(state)
  const response = await anthropic.messages.create({ model: AI_MODEL, ... })
  const suggestions = JSON.parse(response.content[0].text)
  await prisma.aiSuggestion.create({
    data: { studentId, tenantId, suggestions, trigger: 'auto', status: 'ready' }
  })
  // Notify teacher via event bus
  eventBus.emit('ai_suggestion.ready', { teacherId, studentId })
}
```

### On-demand trigger
```
POST /v1/ai/suggest-next/:studentId
  → Check if auto-suggestion exists within last 24h (skip credit if so)
  → Otherwise: decrementAiCredit
  → Immediate generation (not queued)
  → Returns suggestion immediately in response (not via event bus)

POST /v1/ai/suggestions/:id/accept
  → {acceptedIndex: 0|1|2}
  → Set status='accepted', accepted_index
  → Return the accepted suggestion object (client uses it as brief for full lesson generation)

POST /v1/ai/suggestions/:id/dismiss
  → Set status='dismissed'
```

## Definition of done

- All 6 capabilities stream correctly and produce valid JSON
- JSON parse failure triggers one retry, then 422
- `ai_generation_logs` row created for every generation
- Credits decremented atomically, 402 at zero
- Growth tier bypasses credit check
- Draft review flow: approve creates resource, discard soft-deletes
- Auto-trigger fires after lesson completion when conditions met
- On-demand suggestion returns immediately
- Credit waiver when auto-suggestion exists within 24h
- `pnpm test:unit` passes for prompt builders
- `pnpm test:integration` passes for generation + draft flow
