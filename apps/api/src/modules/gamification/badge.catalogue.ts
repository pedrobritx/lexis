/**
 * Badge catalogue — all 12 badges for Phase 1.
 *
 * Deterministic IDs so the seed is idempotent.
 * `triggerCriteria` is the typed JSON stored in the badges table —
 * the evaluator registry reads it to decide whether a student qualifies.
 */

export type BadgeTriggerType = 'lesson.completed' | 'activity.correct' | 'srs.reviewed' | 'streak.milestone'
export type BadgeRarity = 'common' | 'rare' | 'legendary'
export type BadgeIconType = 'emoji' | 'svg_key'

export interface BadgeDefinition {
  id: string
  slug: string
  name: string
  description: string
  triggerType: BadgeTriggerType
  triggerCriteria: Record<string, unknown>
  iconType: BadgeIconType
  rarity: BadgeRarity
  xpReward: number
  visibleToStudent: boolean
}

export const BADGE_CATALOGUE: BadgeDefinition[] = [
  // ── Common (7) ──────────────────────────────────────────

  {
    id: 'ba000001-0000-0000-0000-000000000001',
    slug: 'first-steps',
    name: 'First Steps',
    description: 'Complete your first lesson.',
    triggerType: 'lesson.completed',
    triggerCriteria: { count: 1 },
    iconType: 'emoji',
    rarity: 'common',
    xpReward: 25,
    visibleToStudent: true,
  },
  {
    id: 'ba000001-0000-0000-0000-000000000002',
    slug: 'on-a-roll',
    name: 'On a Roll',
    description: 'Keep a 3-day review streak.',
    triggerType: 'streak.milestone',
    triggerCriteria: { days: 3 },
    iconType: 'emoji',
    rarity: 'common',
    xpReward: 25,
    visibleToStudent: true,
  },
  {
    id: 'ba000001-0000-0000-0000-000000000003',
    slug: 'bookworm',
    name: 'Bookworm',
    description: 'Complete 10 lessons.',
    triggerType: 'lesson.completed',
    triggerCriteria: { count: 10 },
    iconType: 'emoji',
    rarity: 'common',
    xpReward: 50,
    visibleToStudent: true,
  },
  {
    id: 'ba000001-0000-0000-0000-000000000004',
    slug: 'sharp-eye',
    name: 'Sharp Eye',
    description: 'Answer 10 activities in a row correctly.',
    triggerType: 'activity.correct',
    triggerCriteria: { streak: 10 },
    iconType: 'emoji',
    rarity: 'common',
    xpReward: 50,
    visibleToStudent: true,
  },
  {
    id: 'ba000001-0000-0000-0000-000000000005',
    slug: 'review-rookie',
    name: 'Review Rookie',
    description: 'Complete your first SRS review.',
    triggerType: 'srs.reviewed',
    triggerCriteria: { count: 1 },
    iconType: 'emoji',
    rarity: 'common',
    xpReward: 25,
    visibleToStudent: true,
  },
  {
    id: 'ba000001-0000-0000-0000-000000000006',
    slug: 'dedicated-learner',
    name: 'Dedicated Learner',
    description: 'Complete 50 SRS reviews.',
    triggerType: 'srs.reviewed',
    triggerCriteria: { count: 50 },
    iconType: 'emoji',
    rarity: 'common',
    xpReward: 50,
    visibleToStudent: true,
  },
  {
    id: 'ba000001-0000-0000-0000-000000000007',
    slug: 'well-rounded',
    name: 'Well-Rounded',
    description: 'Answer at least one activity correctly in 3 different activity types.',
    triggerType: 'activity.correct',
    triggerCriteria: { distinctTypes: 3 },
    iconType: 'emoji',
    rarity: 'common',
    xpReward: 50,
    visibleToStudent: true,
  },

  // ── Rare (3) ─────────────────────────────────────────────

  {
    id: 'ba000002-0000-0000-0000-000000000001',
    slug: 'week-warrior',
    name: 'Week Warrior',
    description: 'Keep a 7-day review streak.',
    triggerType: 'streak.milestone',
    triggerCriteria: { days: 7 },
    iconType: 'emoji',
    rarity: 'rare',
    xpReward: 100,
    visibleToStudent: true,
  },
  {
    id: 'ba000002-0000-0000-0000-000000000002',
    slug: 'grammar-master',
    name: 'Grammar Master',
    description: 'Achieve 90%+ accuracy on grammar activities (minimum 20 attempts).',
    triggerType: 'activity.correct',
    triggerCriteria: { accuracyPct: 90, minAttempts: 20, skillTagPattern: '_grammar' },
    iconType: 'emoji',
    rarity: 'rare',
    xpReward: 150,
    visibleToStudent: true,
  },
  {
    id: 'ba000002-0000-0000-0000-000000000003',
    slug: 'course-conqueror',
    name: 'Course Conqueror',
    description: 'Complete every lesson in a course.',
    triggerType: 'lesson.completed',
    triggerCriteria: { allLessonsInCourse: true },
    iconType: 'emoji',
    rarity: 'rare',
    xpReward: 150,
    visibleToStudent: true,
  },

  // ── Legendary (2) ────────────────────────────────────────

  {
    id: 'ba000003-0000-0000-0000-000000000001',
    slug: 'month-streak',
    name: 'Unstoppable',
    description: 'Keep a 30-day review streak.',
    triggerType: 'streak.milestone',
    triggerCriteria: { days: 30 },
    iconType: 'emoji',
    rarity: 'legendary',
    xpReward: 300,
    visibleToStudent: true,
  },
  {
    id: 'ba000003-0000-0000-0000-000000000002',
    slug: 'century-club',
    name: 'Century Club',
    description: 'Complete 100 lessons.',
    triggerType: 'lesson.completed',
    triggerCriteria: { count: 100 },
    iconType: 'emoji',
    rarity: 'legendary',
    xpReward: 500,
    visibleToStudent: true,
  },
]

/** Convenience map: slug → BadgeDefinition */
export const BADGE_BY_SLUG = new Map<string, BadgeDefinition>(
  BADGE_CATALOGUE.map((b) => [b.slug, b]),
)
