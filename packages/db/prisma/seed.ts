import { PrismaClient, Role, PlanSlug, Framework, Visibility, CourseStatus, ActivityType, CefrLevel, TenantMemberRole, TenantMemberStatus, BadgeRarity, BadgeIconType } from '@prisma/client'

const prisma = new PrismaClient()

// Deterministic IDs so re-runs are idempotent
const SYSTEM_TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000000000'
const SYSTEM_USER_ID = 'aaaaaaaa-0000-0000-0000-000000000001'
const PEDRO_TENANT_ID = 'bbbbbbbb-0000-0000-0000-000000000000'
const PEDRO_USER_ID = 'bbbbbbbb-0000-0000-0000-000000000001'
const ALICE_USER_ID = 'cccccccc-0000-0000-0000-000000000001'
const BOB_USER_ID = 'cccccccc-0000-0000-0000-000000000002'

// ─── MCQ and Cloze activity content per CEFR level ───────────────────────────

type McqContent = {
  prompt: string
  options: string[]
  correctIndex: number
}

type ClozeContent = {
  text: string
  blanks: { index: number; answer: string; acceptNearMatch: boolean }[]
}

const templateActivities: Record<
  string,
  { lesson1: [McqContent, McqContent, ClozeContent]; lesson2: [McqContent, McqContent, ClozeContent] }
> = {
  A1: {
    lesson1: [
      {
        prompt: 'Which sentence is correct?',
        options: ['I am a teacher.', 'I are a teacher.', 'I is a teacher.', 'I be a teacher.'],
        correctIndex: 0,
      },
      {
        prompt: 'What does "hello" mean?',
        options: ['Goodbye', 'A greeting', 'A question', 'A number'],
        correctIndex: 1,
      },
      {
        text: 'My name ___ Maria.',
        blanks: [{ index: 0, answer: 'is', acceptNearMatch: false }],
      },
    ],
    lesson2: [
      {
        prompt: 'Which word means the opposite of "big"?',
        options: ['large', 'small', 'tall', 'wide'],
        correctIndex: 1,
      },
      {
        prompt: 'How do you say the number 5?',
        options: ['four', 'six', 'five', 'three'],
        correctIndex: 2,
      },
      {
        text: 'The cat ___ on the mat.',
        blanks: [{ index: 0, answer: 'sits', acceptNearMatch: true }],
      },
    ],
  },
  A2: {
    lesson1: [
      {
        prompt: 'Which sentence uses the past simple correctly?',
        options: ['She goed to school.', 'She went to school.', 'She goes to school yesterday.', 'She go to school.'],
        correctIndex: 1,
      },
      {
        prompt: 'Choose the correct preposition: "I arrive ___ the airport."',
        options: ['in', 'on', 'at', 'to'],
        correctIndex: 2,
      },
      {
        text: 'We ___ (go) to the market last Saturday.',
        blanks: [{ index: 0, answer: 'went', acceptNearMatch: false }],
      },
    ],
    lesson2: [
      {
        prompt: '"Can you help me?" is an example of:',
        options: ['a statement', 'a request', 'a command', 'an exclamation'],
        correctIndex: 1,
      },
      {
        prompt: 'Which is the correct plural?',
        options: ['childs', 'childrens', 'children', 'childer'],
        correctIndex: 2,
      },
      {
        text: 'There ___ many people in the park today.',
        blanks: [{ index: 0, answer: 'are', acceptNearMatch: false }],
      },
    ],
  },
  B1: {
    lesson1: [
      {
        prompt: 'Which sentence uses the present perfect correctly?',
        options: [
          'I have went to Paris.',
          'I have been to Paris.',
          'I was go to Paris.',
          'I did went to Paris.',
        ],
        correctIndex: 1,
      },
      {
        prompt: 'Choose the correct form: "If it ___ tomorrow, we will cancel the trip."',
        options: ['rains', 'will rain', 'rained', 'rain'],
        correctIndex: 0,
      },
      {
        text: 'She ___ (live) in London for five years.',
        blanks: [{ index: 0, answer: 'has lived', acceptNearMatch: true }],
      },
    ],
    lesson2: [
      {
        prompt: 'Which word best completes the sentence? "Despite the rain, they ___ the match."',
        options: ['won', 'win', 'winning', 'have win'],
        correctIndex: 0,
      },
      {
        prompt: 'A "compromise" means:',
        options: [
          'a complete victory',
          'an agreement where both sides give something up',
          'a type of promise',
          'a written contract',
        ],
        correctIndex: 1,
      },
      {
        text: 'By the time she arrived, the meeting ___ already ___.',
        blanks: [
          { index: 0, answer: 'had', acceptNearMatch: false },
          { index: 1, answer: 'finished', acceptNearMatch: true },
        ],
      },
    ],
  },
  B2: {
    lesson1: [
      {
        prompt: 'Which sentence uses the subjunctive correctly?',
        options: [
          'I suggest that he goes home.',
          'I suggest that he go home.',
          'I suggest that he went home.',
          'I suggest that he would go home.',
        ],
        correctIndex: 1,
      },
      {
        prompt: 'Choose the most formal alternative to "get rid of":',
        options: ['throw away', 'eliminate', 'dump', 'chuck out'],
        correctIndex: 1,
      },
      {
        text: 'Had she ___ earlier, she would have caught the train.',
        blanks: [{ index: 0, answer: 'left', acceptNearMatch: false }],
      },
    ],
    lesson2: [
      {
        prompt: '"The bill was passed by the parliament." This sentence is in the:',
        options: ['active voice', 'passive voice', 'conditional', 'subjunctive'],
        correctIndex: 1,
      },
      {
        prompt: 'Which is an example of a mixed conditional?',
        options: [
          'If I study, I will pass.',
          'If I had studied, I would have passed.',
          'If I had studied, I would pass now.',
          'If I study, I would pass.',
        ],
        correctIndex: 2,
      },
      {
        text: 'The results of the experiment ___ (publish) in a leading journal next month.',
        blanks: [{ index: 0, answer: 'will be published', acceptNearMatch: true }],
      },
    ],
  },
  C1: {
    lesson1: [
      {
        prompt: 'Which phrase best expresses concession?',
        options: [
          'As a result of this,',
          'Notwithstanding the above,',
          'In addition to this,',
          'Furthermore,',
        ],
        correctIndex: 1,
      },
      {
        prompt: 'Choose the correct collocation: "to ___ a deadline"',
        options: ['do', 'make', 'meet', 'achieve'],
        correctIndex: 2,
      },
      {
        text: 'The politician ___ (be) widely ___ (criticise) for her remarks.',
        blanks: [
          { index: 0, answer: 'has been', acceptNearMatch: false },
          { index: 1, answer: 'criticised', acceptNearMatch: true },
        ],
      },
    ],
    lesson2: [
      {
        prompt: 'Which sentence demonstrates inversion correctly?',
        options: [
          'Never I have seen such beauty.',
          'Never have I seen such beauty.',
          'Never I saw such beauty.',
          'Never saw I such beauty.',
        ],
        correctIndex: 1,
      },
      {
        prompt: '"To beat around the bush" means:',
        options: [
          'to speak directly',
          'to avoid the main topic',
          'to work very hard',
          'to hide information deliberately',
        ],
        correctIndex: 1,
      },
      {
        text: 'Scarcely ___ she entered the room ___ the phone rang.',
        blanks: [
          { index: 0, answer: 'had', acceptNearMatch: false },
          { index: 1, answer: 'when', acceptNearMatch: false },
        ],
      },
    ],
  },
}

async function main() {
  console.log('🌱 Starting seed...')

  // ─── 1. System tenant + subscription + user ──────────────────────────────
  console.log('  → System tenant')
  await prisma.tenant.upsert({
    where: { id: SYSTEM_TENANT_ID },
    update: {},
    create: {
      id: SYSTEM_TENANT_ID,
      name: 'System',
      slug: 'system',
    },
  })

  await prisma.subscription.upsert({
    where: { tenantId: SYSTEM_TENANT_ID },
    update: {},
    create: {
      tenantId: SYSTEM_TENANT_ID,
      planSlug: PlanSlug.pro,
      studentLimit: null,
      lessonPlanLimit: null,
      aiCreditsRemaining: -1,
      featureFlags: { ai: true, analytics: true, whiteboard: true },
    },
  })

  await prisma.user.upsert({
    where: { id: SYSTEM_USER_ID },
    update: {},
    create: {
      id: SYSTEM_USER_ID,
      email: 'system@lexis.app',
      role: Role.system,
      tenantId: null,
    },
  })

  // ─── 2. CEFR template courses ─────────────────────────────────────────────
  const levels: Array<{ level: string; cefrLevel: CefrLevel; title: string }> = [
    { level: 'a1', cefrLevel: CefrLevel.a1, title: 'English A1 — Beginner' },
    { level: 'a2', cefrLevel: CefrLevel.a2, title: 'English A2 — Elementary' },
    { level: 'b1', cefrLevel: CefrLevel.b1, title: 'English B1 — Intermediate' },
    { level: 'b2', cefrLevel: CefrLevel.b2, title: 'English B2 — Upper-Intermediate' },
    { level: 'c1', cefrLevel: CefrLevel.c1, title: 'English C1 — Advanced' },
  ]

  for (const { level, cefrLevel, title } of levels) {
    console.log(`  → Template course: ${cefrLevel.toUpperCase()}`)
    const levelKey = level.toUpperCase() as keyof typeof templateActivities
    const acts = templateActivities[levelKey]

    const course = await prisma.course.upsert({
      where: {
        // No natural unique key on course — use a findFirst + update/create pattern
        id: `aaaaaaaa-${level.padEnd(4, '0')}-0000-0000-000000000000`.substring(0, 36),
      },
      update: {},
      create: {
        id: `aaaaaaaa-${level.padEnd(4, '0')}-0000-0000-000000000000`.substring(0, 36),
        tenantId: SYSTEM_TENANT_ID,
        createdBy: SYSTEM_USER_ID,
        title,
        description: `Official CEFR ${cefrLevel.toUpperCase()} template course. Clone to customise for your students.`,
        targetLanguage: 'en',
        framework: Framework.cefr,
        targetLevel: cefrLevel,
        visibility: Visibility.public_template,
        status: CourseStatus.active,
      },
    })

    const unit = await prisma.unit.upsert({
      where: { id: `bbbbbbbb-${level.padEnd(4, '0')}-0000-0000-000000000000`.substring(0, 36) },
      update: {},
      create: {
        id: `bbbbbbbb-${level.padEnd(4, '0')}-0000-0000-000000000000`.substring(0, 36),
        courseId: course.id,
        tenantId: SYSTEM_TENANT_ID,
        title: 'Unit 1 — Core Skills',
        position: 1,
      },
    })

    const lessons = [
      { suffix: '01', title: 'Lesson 1 — Grammar Focus', activities: acts.lesson1 },
      { suffix: '02', title: 'Lesson 2 — Vocabulary & Usage', activities: acts.lesson2 },
    ]

    for (let li = 0; li < lessons.length; li++) {
      const { suffix, title: lessonTitle, activities } = lessons[li]
      const lessonId = `cccccccc-${level.padEnd(4, '0')}-${suffix}00-0000-000000000000`.substring(0, 36)

      const lesson = await prisma.lesson.upsert({
        where: { id: lessonId },
        update: {},
        create: {
          id: lessonId,
          unitId: unit.id,
          tenantId: SYSTEM_TENANT_ID,
          title: lessonTitle,
          position: li + 1,
          estimatedMinutes: 15,
        },
      })

      for (let ai = 0; ai < activities.length; ai++) {
        const act = activities[ai]
        const activityId = `dddddddd-${level.padEnd(4, '0')}-${suffix}0${ai}-0000-000000000000`.substring(0, 36)
        const isCloze = 'blanks' in act
        const actType = isCloze ? ActivityType.cloze : ActivityType.mcq

        await prisma.activity.upsert({
          where: { id: activityId },
          update: {},
          create: {
            id: activityId,
            lessonId: lesson.id,
            tenantId: SYSTEM_TENANT_ID,
            type: actType,
            title: isCloze ? 'Fill in the blank' : `Multiple choice ${ai + 1}`,
            content: act,
            scoringRules: isCloze ? { acceptNearMatch: (act as ClozeContent).blanks.some(b => b.acceptNearMatch) } : null,
            skillTags: [`${cefrLevel}_grammar`],
            visibility: Visibility.public_template,
            version: 1,
          },
        })
      }
    }
  }

  // ─── 3. Pedro's tenant + teacher ─────────────────────────────────────────
  console.log("  → Pedro's tenant")
  await prisma.tenant.upsert({
    where: { id: PEDRO_TENANT_ID },
    update: {},
    create: {
      id: PEDRO_TENANT_ID,
      name: "Pedro's ESL Studio",
      slug: 'pedro-esl',
    },
  })

  await prisma.subscription.upsert({
    where: { tenantId: PEDRO_TENANT_ID },
    update: {},
    create: {
      tenantId: PEDRO_TENANT_ID,
      planSlug: PlanSlug.free,
      studentLimit: 3,
      lessonPlanLimit: 5,
      aiCreditsRemaining: 0,
      featureFlags: { ai: false, analytics: false, whiteboard: false },
    },
  })

  await prisma.user.upsert({
    where: { id: PEDRO_USER_ID },
    update: {},
    create: {
      id: PEDRO_USER_ID,
      email: 'pedro@lexis.app',
      role: Role.teacher,
      tenantId: PEDRO_TENANT_ID,
    },
  })

  await prisma.tenantMember.upsert({
    where: { id: `pedro-member-0000-0000-0000-000000000000`.substring(0, 36) },
    update: {},
    create: {
      id: `pedro-member-0000-0000-0000-000000000000`.substring(0, 36),
      tenantId: PEDRO_TENANT_ID,
      userId: PEDRO_USER_ID,
      role: TenantMemberRole.owner,
      status: TenantMemberStatus.active,
      joinedAt: new Date(),
    },
  })

  await prisma.teacherProfile.upsert({
    where: { userId: PEDRO_USER_ID },
    update: {},
    create: {
      userId: PEDRO_USER_ID,
      tenantId: PEDRO_TENANT_ID,
      displayName: 'Pedro',
      teacherLanguage: 'en',
      bio: 'ESL teacher with a passion for communicative language teaching.',
    },
  })

  // ─── 4. Test students ─────────────────────────────────────────────────────
  console.log('  → Test students (Alice, Bob)')
  const students = [
    {
      id: ALICE_USER_ID,
      email: 'alice@test.lexis.app',
      displayName: 'Alice',
      cefrLevel: CefrLevel.b1,
      timezone: 'Europe/London',
    },
    {
      id: BOB_USER_ID,
      email: 'bob@test.lexis.app',
      displayName: 'Bob',
      cefrLevel: CefrLevel.a2,
      timezone: 'America/New_York',
    },
  ]

  for (const student of students) {
    await prisma.user.upsert({
      where: { id: student.id },
      update: {},
      create: {
        id: student.id,
        email: student.email,
        role: Role.student,
        tenantId: PEDRO_TENANT_ID,
      },
    })

    await prisma.studentProfile.upsert({
      where: { userId: student.id },
      update: {},
      create: {
        userId: student.id,
        tenantId: PEDRO_TENANT_ID,
        displayName: student.displayName,
        cefrLevel: student.cefrLevel,
        timezone: student.timezone,
      },
    })
  }

  // ─── 5. Badge catalogue ───────────────────────────────────────────────────
  console.log('  → Badge catalogue (12 badges)')

  type BadgeSeed = {
    id: string
    slug: string
    name: string
    description: string
    triggerType: string
    triggerCriteria: object
    iconType: BadgeIconType
    rarity: BadgeRarity
    xpReward: number
    visibleToStudent: boolean
  }

  const badges: BadgeSeed[] = [
    // ── Common (7) ──
    {
      id: 'ba000001-0000-0000-0000-000000000001',
      slug: 'first-steps',
      name: 'First Steps',
      description: 'Complete your first lesson.',
      triggerType: 'lesson.completed',
      triggerCriteria: { count: 1 },
      iconType: BadgeIconType.emoji,
      rarity: BadgeRarity.common,
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
      iconType: BadgeIconType.emoji,
      rarity: BadgeRarity.common,
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
      iconType: BadgeIconType.emoji,
      rarity: BadgeRarity.common,
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
      iconType: BadgeIconType.emoji,
      rarity: BadgeRarity.common,
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
      iconType: BadgeIconType.emoji,
      rarity: BadgeRarity.common,
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
      iconType: BadgeIconType.emoji,
      rarity: BadgeRarity.common,
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
      iconType: BadgeIconType.emoji,
      rarity: BadgeRarity.common,
      xpReward: 50,
      visibleToStudent: true,
    },
    // ── Rare (3) ──
    {
      id: 'ba000002-0000-0000-0000-000000000001',
      slug: 'week-warrior',
      name: 'Week Warrior',
      description: 'Keep a 7-day review streak.',
      triggerType: 'streak.milestone',
      triggerCriteria: { days: 7 },
      iconType: BadgeIconType.emoji,
      rarity: BadgeRarity.rare,
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
      iconType: BadgeIconType.emoji,
      rarity: BadgeRarity.rare,
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
      iconType: BadgeIconType.emoji,
      rarity: BadgeRarity.rare,
      xpReward: 150,
      visibleToStudent: true,
    },
    // ── Legendary (2) ──
    {
      id: 'ba000003-0000-0000-0000-000000000001',
      slug: 'month-streak',
      name: 'Unstoppable',
      description: 'Keep a 30-day review streak.',
      triggerType: 'streak.milestone',
      triggerCriteria: { days: 30 },
      iconType: BadgeIconType.emoji,
      rarity: BadgeRarity.legendary,
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
      iconType: BadgeIconType.emoji,
      rarity: BadgeRarity.legendary,
      xpReward: 500,
      visibleToStudent: true,
    },
  ]

  for (const badge of badges) {
    await prisma.badge.upsert({
      where: { id: badge.id },
      update: {},
      create: badge,
    })
  }

  console.log('✅ Seed complete.')
  console.log('   tenants:  system, pedro-esl')
  console.log('   users:    system, pedro, alice, bob')
  console.log('   courses:  5 CEFR templates (A1–C1)')
  console.log('   badges:   12 (7 common, 3 rare, 2 legendary)')
}

main()
  .catch(e => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
