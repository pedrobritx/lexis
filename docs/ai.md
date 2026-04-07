# AI Generation

## Capabilities

| Capability | Input | Output | ~Tokens |
|---|---|---|---|
| `full_lesson` | Topic, CEFR level, grammar targets, duration, student interests | Lesson title + objective + 4–6 mixed activities with answer keys | ~2,000 |
| `activity` | Activity type, grammar target, CEFR level, optional context | Single activity JSON + answer key | ~500 |
| `rubric` | Writing prompt, CEFR level, skill focus | 3–5 criteria with descriptions and max points | ~400 |
| `adapt_lesson` | Existing lesson JSON, source level, target level | Modified lesson JSON — same topic, adjusted complexity | ~1,500 |
| `personalised_review` | Top 3 error patterns (tag + accuracy_pct), student interests | 2–3 targeted activities per error pattern | ~800 |
| `suggest_next` | Lesson history, accuracy trends, current level, remaining units | 3 ranked suggestions with rationale | ~600 |

## Review flow — MANDATORY

**AI never saves directly to a course.** Always:

```
Teacher submits brief
    → POST /v1/ai/generate
    → SSE stream to client (teacher watches real-time)
    → On complete: ai_drafts row created (status = 'pending_review')
    → Teacher reviews draft in UI (can edit inline, regenerate sections)
    → POST /v1/ai/drafts/:id/approve → creates lesson/activity in course
    OR POST /v1/ai/drafts/:id/discard → soft-deletes draft
```

Never bypass this flow. Even if a teacher requests "auto-save", the draft review is non-negotiable.

## Prompt architecture

All prompts live in `packages/ai-prompts/` as versioned TypeScript files:

```
packages/ai-prompts/
  generate-lesson.v1.ts
  generate-activity.v1.ts
  generate-rubric.v1.ts
  adapt-lesson.v1.ts
  personalised-review.v1.ts
  suggest-next-lesson.v1.ts
```

Each file exports:
```typescript
export interface GenerateLessonParams {
  topic: string
  cefrLevel: string
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

**System message** defines: output JSON schema (must match Lesson DTO exactly), CEFR level descriptions, activity type formats, answer key structure, skill_tag catalogue.

**JSON enforcement:** if JSON parse fails on streaming completion, retry once with `"\n\nReturn ONLY valid JSON, no markdown fences, no preamble."` appended to the user message. Log the failure to `ai_generation_logs`. If second attempt fails, return 422 to client.

## SSE streaming implementation

```typescript
// POST /v1/ai/generate
async function generateHandler(req, reply) {
  // 1. Check credits
  await decrementAiCredit(req.user.tenantId)  // throws 402 if insufficient

  // 2. Set SSE headers
  reply.raw.setHeader('Content-Type', 'text/event-stream')
  reply.raw.setHeader('Cache-Control', 'no-cache')
  reply.raw.setHeader('Connection', 'keep-alive')

  // 3. Build prompt
  const { system, user } = buildPrompt(req.body)

  // 4. Stream from Anthropic
  let fullText = ''
  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system,
    messages: [{ role: 'user', content: user }],
  })

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta') {
      const text = chunk.delta.text
      fullText += text
      reply.raw.write(`data: ${JSON.stringify({ text })}\n\n`)
    }
  }

  // 5. Store draft
  const draft = await prisma.aiDraft.create({
    data: {
      tenantId: req.user.tenantId,
      createdBy: req.user.userId,
      capability: req.body.capability,
      brief: req.body,
      output: JSON.parse(fullText),
      status: 'pending_review',
      promptVersion: 'generate-lesson.v1',
      tokensUsed: stream.usage.output_tokens,
    }
  })

  // 6. Log usage
  await logGeneration({ draftId: draft.id, ...stream.usage })

  reply.raw.write(`data: ${JSON.stringify({ done: true, draftId: draft.id })}\n\n`)
  reply.raw.end()
}
```

## Next lesson suggestions — dual trigger

**Auto-trigger:** BullMQ job fires after every `lesson.completed` event.
Conditions to fire generation:
- Student has completed ≥3 lessons in current unit
- No suggestion generated in last 7 days for this student
- Last lesson accuracy ≥70%

Result stored in `ai_suggestions` with `trigger = 'auto'`. Teacher sees amber badge on student card.

**On-demand:** `POST /v1/ai/suggest-next/:studentId`
- Immediate (not queued)
- Credit waived if auto-suggestion exists for same student within 24 hours
- Returns suggestion panel with 3 ranked options

**Accept:** `POST /v1/ai/suggestions/:id/accept` with `{acceptedIndex: 0|1|2}`
- Sets `status = 'accepted'`, `accepted_index`
- The accepted suggestion object is passed as the brief to a `full_lesson` generation

## Credit system

```typescript
// subscriptions.ai_credits_remaining:
// -1 = unlimited (Growth tier)
//  0 = exhausted (free tier default)
//  N = credits remaining

async function decrementAiCredit(tenantId: string) {
  const sub = await getSubscription(tenantId)
  if (sub.ai_credits_remaining === -1) return  // Growth: unlimited
  if (sub.ai_credits_remaining === 0) {
    throw new BillingError('billing/insufficient_credits', 'No AI credits remaining')
  }
  // Atomic decrement in PostgreSQL transaction
  await prisma.$transaction(async (tx) => {
    const updated = await tx.subscription.update({
      where: { tenantId, ai_credits_remaining: { gt: 0 } },
      data: { ai_credits_remaining: { decrement: 1 } }
    })
    if (!updated) throw new BillingError('billing/insufficient_credits', 'Race condition')
  })
}
```

Monthly reset triggered by `invoice.paid` Stripe webhook → `UPDATE subscriptions SET ai_credits_remaining = plan_limit WHERE tenant_id = ?`.

## Model

Always use `claude-sonnet-4-6`. Do not use Opus (cost) or Haiku (quality). Do not hardcode the model string in individual prompt files — use the constant from `packages/ai-prompts/constants.ts`:

```typescript
export const AI_MODEL = 'claude-sonnet-4-6'
export const AI_MAX_TOKENS = 4096
```
