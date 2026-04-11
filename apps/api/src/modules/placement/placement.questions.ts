/**
 * Placement test question bank.
 * 2 MCQ + 1 cloze per level, A1–C1 (5 levels = 15 questions total).
 *
 * NEVER send `correctAnswer` to the client — strip it in getPublicQuestions().
 */

export type CefrLevel = 'a1' | 'a2' | 'b1' | 'b2' | 'c1'
export type QuestionType = 'mcq' | 'cloze'

export interface Question {
  id: string
  level: CefrLevel
  type: QuestionType
  prompt: string
  options?: string[]     // MCQ only
  correctAnswer?: string // MCQ only — never exposed to client
  version: number
}

export const LEVELS_ORDERED: CefrLevel[] = ['a1', 'a2', 'b1', 'b2', 'c1']

export const QUESTION_BANK: Question[] = [
  // ── A1 — Basic grammar & vocabulary ─────────────────────
  {
    id: 'a1_mcq1',
    level: 'a1',
    type: 'mcq',
    prompt: 'I ___ a student.',
    options: ['am', 'is', 'are', 'be'],
    correctAnswer: 'am',
    version: 1,
  },
  {
    id: 'a1_mcq2',
    level: 'a1',
    type: 'mcq',
    prompt: 'What is the opposite of "big"?',
    options: ['small', 'tall', 'heavy', 'old'],
    correctAnswer: 'small',
    version: 1,
  },
  {
    id: 'a1_cloze',
    level: 'a1',
    type: 'cloze',
    prompt: 'Complete the sentence with a word or number: "She has ___ brothers."',
    version: 1,
  },

  // ── A2 — Simple present & basic tenses ──────────────────
  {
    id: 'a2_mcq1',
    level: 'a2',
    type: 'mcq',
    prompt: 'She ___ to school every day.',
    options: ['go', 'goes', 'going', 'gone'],
    correctAnswer: 'goes',
    version: 1,
  },
  {
    id: 'a2_mcq2',
    level: 'a2',
    type: 'mcq',
    prompt: 'How long have you ___ here?',
    options: ['been', 'be', 'was', 'being'],
    correctAnswer: 'been',
    version: 1,
  },
  {
    id: 'a2_cloze',
    level: 'a2',
    type: 'cloze',
    prompt: 'Write the past tense of the verb "run":',
    version: 1,
  },

  // ── B1 — Conditionals & passive ──────────────────────────
  {
    id: 'b1_mcq1',
    level: 'b1',
    type: 'mcq',
    prompt: 'If I ___ more free time, I would travel more.',
    options: ['had', 'have', 'has', 'having'],
    correctAnswer: 'had',
    version: 1,
  },
  {
    id: 'b1_mcq2',
    level: 'b1',
    type: 'mcq',
    prompt: 'The report was ___ by the manager yesterday.',
    options: ['wrote', 'written', 'writing', 'write'],
    correctAnswer: 'written',
    version: 1,
  },
  {
    id: 'b1_cloze',
    level: 'b1',
    type: 'cloze',
    prompt: 'In 2–3 sentences, describe what you would do if you had a week off work or school.',
    version: 1,
  },

  // ── B2 — Gerunds / infinitives & complex verb forms ──────
  {
    id: 'b2_mcq1',
    level: 'b2',
    type: 'mcq',
    prompt: 'Despite ___ tired, she finished the project on time.',
    options: ['be', 'been', 'being', 'to be'],
    correctAnswer: 'being',
    version: 1,
  },
  {
    id: 'b2_mcq2',
    level: 'b2',
    type: 'mcq',
    prompt: 'The new policy ___ to have a positive effect on unemployment.',
    options: ['appears', 'appear', 'is appearing', 'appeared'],
    correctAnswer: 'appears',
    version: 1,
  },
  {
    id: 'b2_cloze',
    level: 'b2',
    type: 'cloze',
    prompt: 'In 2–3 sentences, describe one advantage and one disadvantage of remote work.',
    version: 1,
  },

  // ── C1 — Inversion & complex participle constructions ────
  {
    id: 'c1_mcq1',
    level: 'c1',
    type: 'mcq',
    prompt: 'Not only ___ the task completed, but it was done ahead of schedule.',
    options: ['it was', 'was it', 'had it', 'has it'],
    correctAnswer: 'was it',
    version: 1,
  },
  {
    id: 'c1_mcq2',
    level: 'c1',
    type: 'mcq',
    prompt: 'The phenomenon, ___ for decades, remains poorly understood.',
    options: [
      'that studied',
      'which having been studied',
      'having been studied',
      'studied',
    ],
    correctAnswer: 'having been studied',
    version: 1,
  },
  {
    id: 'c1_cloze',
    level: 'c1',
    type: 'cloze',
    prompt:
      'In 3–4 sentences, critically evaluate the claim that technology has made modern life more stressful.',
    version: 1,
  },
]

/** Strip correctAnswer before sending to the client. */
export function getPublicQuestions() {
  return QUESTION_BANK.map(({ correctAnswer: _omit, ...q }) => q)
}
