# AI Generation

---

## Capabilities

| Capability | Input | Output | ~Tokens |
|---|---|---|---|
| `full_lesson` | Topic, CEFR level, grammar targets, duration, student interests | Lesson title + objective + 4–6 mixed activities with answer keys | ~2,000 |
| `activity` | Activity type, grammar target, CEFR level, optional context | Single activity JSON + answer key | ~500 |
| `rubric` | Writing prompt, CEFR level, skill focus | 3–5 criteria with descriptions and max points | ~400 |
| `adapt_lesson` | Existing lesson JSON, source level, target level | Modified lesson JSON — same topic, adjusted complexity | ~1,500 |
| `personalised_review` | Top 3 error patterns (tag + accuracy_pct), student interests | 2–3 targeted activities per error pattern | ~800 |
| `suggest_next` | Lesson history, accuracy trends, current level, remaining units | 3 ranked suggestions with rationale | ~600 |

---

## Mandatory draft review flow

**AI output is never saved directly to a course.** Always:

```
1. Teacher submits brief → POST /v1/ai/generate
2. SSE stream to client (teacher watches content appear in real-time)
3. On complete → ai_drafts row created (status = 'pending_review')
4. Teacher reviews draft in UI (can edit inline, regenerate sections)
5a. POST /v1/ai/drafts/:id/approve → creates lesson/activity in course
5b. POST /v1/ai/drafts/:id/discard → sets status = 'discarded'
```

Even if a teacher requests "auto-save", the draft review step is non-negotiable.

---

## Generate endpoint

```
POST /v1/ai/generate
  Body:
  {
    "capability": "full_lesson",
    "cefrLevel": "b1",
    "topic": "Giving advice",
    "grammarTargets": ["second_conditional", "should/shouldn't"],
    "durationMinutes": 30,
    "studentInterests": ["travel", "cooking"],
    "targetLanguage": "en"
  }
```

### Implementation

```typescript
async function generateHandler(req, reply) {
  // 1. Check credits (throws 402 if insufficient)
  await decrementAiCredit(req.user.tenantId)

  // 2. Set SSE headers
  reply.raw.setHeader('Content-Type', 'text/event-stream')
  reply.raw.setHeader('Cache-Control', 'no-cache')
  reply.raw.setHeader('Connection', 'keep-alive')

  // 3. Build prompt
  const { system, user } = buildPrompt(req.body)

  // 4. Stream from Anthropic
  let fullText = ''
  const stream = anthropic.messages.stream({
    model: AI_MODEL,          // 'claude-sonnet-4-6' — from packages/ai-prompts/constants.ts
    max_tokens: AI_MAX_TOKENS, // 4096
    system,
    messages: [{ role: 'user', content: user }],
  })

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta') {
      fullText += chunk.delta.text
      reply.raw.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`)
    }
  }

  // 5. Parse JSON — with retry on failure
  let output: object
  try {
    output = JSON.parse(fullText)
  } catch {
    // Retry with JSON enforcement instruction
    output = await retryWithJsonEnforcement(req.body, fullText)
  }

  // 6. Store draft
  const draft = await prisma.aiDraft.create({
    data: {
      tenantId: req.user.tenantId,
      createdBy: req.user.userId,
      capability: req.body.capability,
      brief: req.body,
      output,
      status: 'pending_review',
      promptVersion: `generate-${req.body.capability}.v1`,
      tokensUsed: stream.usage.output_tokens
    }
  })

  // 7. Log usage
  await logGeneration({ draftId: draft.id, ...stream.usage, latency_ms })

  // 8. Close stream
  reply.raw.write(`data: ${JSON.stringify({ done: true, draftId: draft.id })}\n\n`)
  reply.raw.end()
}
```

---

## JSON enforcement

If the initial response fails JSON parsing, retry once with an appended instruction:

```typescript
async function retryWithJsonEnforcement(brief, failedOutput) {
  const retryUser = `${buildPrompt(brief).user}\n\nReturn ONLY valid JSON, no markdown fences, no preamble.`
  const retryStream = anthropic.messages.stream({ model: AI_MODEL, ..., messages: [{ role: 'user', content: retryUser }] })
  const retryText = await collectStream(retryStream)

  try {
    return JSON.parse(retryText)
  } catch {
    // Log the failure — return 422 to client
    await logGenerationFailure({ brief, failedOutput, retryOutput: retryText })
    throw new UnprocessableError('ai/json_parse_failed', 'AI output could not be parsed')
  }
}
```

---

## Draft review endpoints

```
GET    /v1/ai/drafts              List teacher's pending drafts
GET    /v1/ai/drafts/:id          Get single draft with output
PATCH  /v1/ai/drafts/:id          Inline edit (teacher modifies output before approving)
POST   /v1/ai/drafts/:id/approve  Creates lesson/activity in course, sets status = 'approved'
POST   /v1/ai/drafts/:id/discard  Sets status = 'discarded'
```

---

## Model constants

Always import from `packages/ai-prompts/constants.ts`:

```typescript
export const AI_MODEL = 'claude-sonnet-4-6'
export const AI_MAX_TOKENS = 4096
```

Do not use Opus (too expensive) or Haiku (insufficient quality for lesson generation). Do not hardcode the model string in individual files.

---

## Credit system

See [[Billing-and-Plans]] for the full credit system documentation. Quick reference:

- `ai_credits_remaining = -1` → Growth tier (unlimited)
- `ai_credits_remaining = 0` → Credits exhausted (throws 402)
- `ai_credits_remaining = N` → Decrement atomically before each generation
