/**
 * Badge catalogue — all 12 badges for Phase 1.
 *
 * IDs and triggerCriteria format must stay in sync with packages/db/prisma/seed.ts.
 * The badge.service.ts queries the DB (seeded from seed.ts) as the source of truth;
 * this file is the TypeScript documentation layer.
 *
 * triggerCriteria shapes used by badge.evaluators.ts:
 *   { type: 'count', threshold: N }                               — lesson/srs count
 *   { type: 'consecutive_correct', threshold: N }                  — activity streak
 *   { type: 'type_variety', threshold: N }                         — distinct activity types
 *   { type: 'grammar_accuracy', accuracy_pct: N, min_attempts: N, skill_tag_pattern: string }
 *   { type: 'course_conqueror' }                                   — all lessons in a course
 *   { type: 'streak_days', days: N }                               — streak milestone
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
    id: 'badge000-0000-0000-0000-000000000001',
    slug: 'first-steps',
    name: 'First Steps',
    description: 'Complete your very first lesson.',
    triggerType: 'lesson.completed',
    triggerCriteria: { type: 'count', threshold: 1 },
    iconType: 'emoji',
    rarity: 'common',
    xpReward: 25,
    visibleToStudent: true,
  },
  {
    id: 'badge000-0000-0000-0000-000000000002',
    slug: 'on-a-roll',
    name: 'On a Roll',
    description: 'Maintain a 3-day study streak.',
    triggerType: 'streak.milestone',
    triggerCriteria: { type: 'streak_days', days: 3 },
    iconType: 'emoji',
    rarity: 'common',
    xpReward: 25,
    visibleToStudent: true,
  },
  {
    id: 'badge000-0000-0000-0000-000000000003',
    slug: 'bookworm',
    name: 'Bookworm',
    description: 'Complete 10 lessons.',
    triggerType: 'lesson.completed',
    triggerCriteria: { type: 'count', threshold: 10 },
    iconType: 'emoji',
    rarity: 'common',
    xpReward: 50,
    visibleToStudent: true,
  },
  {
    id: 'badge000-0000-0000-0000-000000000004',
    slug: 'sharp-eye',
    name: 'Sharp Eye',
    description: 'Answer 10 activities correctly in a row.',
    triggerType: 'activity.correct',
    triggerCriteria: { type: 'consecutive_correct', threshold: 10 },
    iconType: 'emoji',
    rarity: 'common',
    xpReward: 50,
    visibleToStudent: true,
  },
  {
    id: 'badge000-0000-0000-0000-000000000005',
    slug: 'review-rookie',
    name: 'Review Rookie',
    description: 'Complete your first spaced-review session.',
    triggerType: 'srs.reviewed',
    triggerCriteria: { type: 'count', threshold: 1 },
    iconType: 'emoji',
    rarity: 'common',
    xpReward: 25,
    visibleToStudent: true,
  },
  {
    id: 'badge000-0000-0000-0000-000000000006',
    slug: 'dedicated-learner',
    name: 'Dedicated Learner',
    description: 'Complete 50 spaced-review sessions.',
    triggerType: 'srs.reviewed',
    triggerCriteria: { type: 'count', threshold: 50 },
    iconType: 'emoji',
    rarity: 'common',
    xpReward: 50,
    visibleToStudent: true,
  },
  {
    id: 'badge000-0000-0000-0000-000000000007',
    slug: 'well-rounded',
    name: 'Well-Rounded',
    description: 'Answer correctly in 3 or more different activity types.',
    triggerType: 'activity.correct',
    triggerCriteria: { type: 'type_variety', threshold: 3 },
    iconType: 'emoji',
    rarity: 'common',
    xpReward: 50,
    visibleToStudent: true,
  },

  // ── Rare (3) ─────────────────────────────────────────────

  {
    id: 'badge000-0000-0000-0000-000000000008',
    slug: 'week-warrior',
    name: 'Week Warrior',
    description: 'Maintain a 7-day study streak.',
    triggerType: 'streak.milestone',
    triggerCriteria: { type: 'streak_days', days: 7 },
    iconType: 'emoji',
    rarity: 'rare',
    xpReward: 100,
    visibleToStudent: true,
  },
  {
    id: 'badge000-0000-0000-0000-000000000009',
    slug: 'grammar-master',
    name: 'Grammar Master',
    description: 'Achieve 90%+ accuracy across 20+ grammar-tagged activities.',
    triggerType: 'activity.correct',
    triggerCriteria: {
      type: 'grammar_accuracy',
      accuracy_pct: 90,
      min_attempts: 20,
      skill_tag_pattern: 'grammar',
    },
    iconType: 'emoji',
    rarity: 'rare',
    xpReward: 150,
    visibleToStudent: true,
  },
  {
    id: 'badge000-0000-0000-0000-000000000010',
    slug: 'course-conqueror',
    name: 'Course Conqueror',
    description: 'Complete every lesson in an entire course.',
    triggerType: 'lesson.completed',
    triggerCriteria: { type: 'course_conqueror' },
    iconType: 'emoji',
    rarity: 'rare',
    xpReward: 150,
    visibleToStudent: true,
  },

  // ── Legendary (2) ────────────────────────────────────────

  {
    id: 'badge000-0000-0000-0000-000000000011',
    slug: 'month-streak',
    name: 'Unstoppable',
    description: 'Maintain a 30-day study streak.',
    triggerType: 'streak.milestone',
    triggerCriteria: { type: 'streak_days', days: 30 },
    iconType: 'emoji',
    rarity: 'legendary',
    xpReward: 300,
    visibleToStudent: true,
  },
  {
    id: 'badge000-0000-0000-0000-000000000012',
    slug: 'century-club',
    name: 'Century Club',
    description: 'Complete 100 lessons.',
    triggerType: 'lesson.completed',
    triggerCriteria: { type: 'count', threshold: 100 },
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
