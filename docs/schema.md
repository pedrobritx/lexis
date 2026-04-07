# Data Model

Complete schema reference. All entities across all phases. See `scaffold/schema.prisma` for the executable Prisma schema.

## Tenant + subscription layer (Phase 1)

### tenants
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | string | Teacher's brand name |
| slug | string unique | URL-safe identifier |
| stripe_customer_id | string? | null on free tier |
| created_at | timestamp | |

### subscriptions
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK unique | One per tenant |
| plan_slug | enum | free · pro · growth |
| student_limit | int | 3 on free, null = unlimited |
| lesson_plan_limit | int | 5 on free, null = unlimited |
| ai_credits_remaining | int | 0 on free, 50 on pro, -1 = unlimited |
| feature_flags | jsonb | {ai: bool, analytics: bool, ...} |
| renews_at | date? | |

---

## Auth layer (Phase 1)

### users
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK? | null until tenant created |
| email | string unique | |
| role | enum | teacher · student · system |
| age_group | enum? | adult · minor |
| deleted_at | timestamp? | GDPR soft-delete |
| created_at | timestamp | |

**No `hashed_password` column — passwords do not exist in this system.**

### passkey_credentials
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK | |
| credential_id | bytes unique | WebAuthn credential ID |
| public_key | bytes | COSE-encoded public key |
| sign_count | int | Replay attack prevention |
| device_label | string? | "iPhone 15", "MacBook Pro" |
| created_at | timestamp | |

### consent_records
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK | |
| accepted_at | timestamp | |
| policy_version | string | "1.0" |
| ip_address | string | Hashed |

---

## Content layer (Phase 1)

### teacher_profiles
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK unique | |
| tenant_id | uuid FK | |
| display_name | string | |
| teacher_language | string? | ISO 639-1 — UI language |
| bio | text? | |

### student_profiles
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK unique | |
| tenant_id | uuid FK | |
| display_name | string | |
| cefr_level | enum? | a1·a2·b1·b2·c1·c2 |
| streak_days | int | default 0 |
| streak_grace_used_at | timestamp? | Phase 4 |
| disengagement_flag | bool | Phase 4, set by nightly cron |
| timezone | string | IANA tz, Phase 4 |
| xp_total | int | default 0 |

### courses
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK | |
| created_by | uuid FK | |
| title | string | |
| description | text? | |
| target_language | string | ISO 639-1, default 'en' |
| framework | enum | cefr·jlpt·hsk·custom |
| target_level | string | Level within framework |
| teacher_language | string? | |
| visibility | enum | private · public_template |
| status | enum | draft · active · archived |
| version | int | Auto-increment on update |
| deleted_at | timestamp? | Soft-delete |

### units
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| course_id | uuid FK | |
| tenant_id | uuid FK | |
| title | string | |
| position | int | Sort order |
| deleted_at | timestamp? | |

### lessons
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| unit_id | uuid FK | |
| tenant_id | uuid FK | |
| title | string | |
| objective | text? | |
| position | int | |
| estimated_minutes | int? | |
| deleted_at | timestamp? | |

### activities
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| lesson_id | uuid FK | |
| tenant_id | uuid FK | |
| type | enum | cloze·mcq·matching·ordering·open_writing·listening |
| title | string | |
| content | jsonb | Type-specific content + answer key |
| scoring_rules | jsonb? | {accept_near_match, rubric, rubric_template_id} |
| skill_tags | string[] | Grammar/vocab tags for error analysis |
| srs_mode | enum? | flashcard · mini_lesson (Phase 2) |
| media_asset_id | uuid FK? | Phase 2 |
| rubric_template_id | uuid FK? | Phase 2 |
| image_url | string? | Phase 1 shortcut — replaced by media_asset_id in Phase 2 |
| visibility | enum | private · public_template |
| version | int | |
| deleted_at | timestamp? | |

---

## Progress layer (Phase 1)

### classrooms
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK | |
| teacher_id | uuid FK | |
| name | string | |
| course_id | uuid FK? | Primary course |
| status | enum | active · paused · archived |

### enrollments
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| classroom_id | uuid FK | |
| student_id | uuid FK | |
| tenant_id | uuid FK | |
| enrolled_at | timestamp | |

### sessions
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK | |
| teacher_id | uuid FK | |
| student_id | uuid FK? | Nullable — 1-on-1 only |
| classroom_id | uuid FK? | Nullable — group only |
| status | enum | scheduled·active·completed·cancelled |
| started_at | timestamp? | |
| ended_at | timestamp? | |
| duration_secs | int? | |

**Constraint: exactly one of student_id / classroom_id must be non-null.**

### session_participants
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| session_id | uuid FK | |
| student_id | uuid FK | |
| tenant_id | uuid FK | |
| joined_at | timestamp? | |
| left_at | timestamp? | |
| status | enum | invited · joined · absent |

### lesson_progress
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| student_id | uuid FK | |
| lesson_id | uuid FK | |
| tenant_id | uuid FK | |
| status | enum | not_started·in_progress·completed |
| score_pct | float? | |
| completed_at | timestamp? | |

### activity_attempts
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| student_id | uuid FK | |
| activity_id | uuid FK | |
| tenant_id | uuid FK | |
| correct | bool | |
| score | float? | Partial scoring |
| response | jsonb? | Student's answer |
| attempted_at | timestamp | |
| annotation_stroke_key | string? | Phase 3 — S3 key for teacher corrections |
| annotation_comments | jsonb? | Phase 3 |

---

## SRS layer (Phase 1)

### srs_items
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| student_id | uuid FK | |
| activity_id | uuid FK | |
| tenant_id | uuid FK | |
| srs_mode | enum | flashcard · mini_lesson |
| ease_factor | float | SM-2, default 2.5 |
| interval_days | int | default 1 |
| next_review | date | |
| activity_version | int | Snapshot at creation — detect stale content |
| repetitions | int | default 0 |

---

## Billing layer (Phase 2 SaaS)

### upgrade_requests
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK | |
| target_plan | enum | pro · growth |
| motivation | text | Teacher's message |
| status | enum | pending·approved·rejected |
| reviewed_by | string? | Admin user |
| reviewed_at | timestamp? | |
| created_at | timestamp | |

### billing_events
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK | |
| stripe_event_id | string unique | Idempotency key |
| event_type | string | e.g. invoice.paid |
| payload | jsonb | Full Stripe event |
| processed_at | timestamp | |

### usage_snapshots
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK | |
| snapshot_date | date | |
| student_count | int | |
| course_count | int | |
| storage_bytes | bigint | |
| ai_credits_used | int | |
| sessions_count | int | |

### tenant_members
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK | |
| user_id | uuid FK | |
| role | enum | owner · teacher · admin |
| invited_by | uuid FK? | |
| joined_at | timestamp? | |
| status | enum | invited · active · removed |

---

## Placement test (Phase 1)

### placement_tests
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| student_id | uuid FK | No unique constraint — retakeable |
| tenant_id | uuid FK | |
| score | int | |
| result_level | enum | a1·a2·b1·b2·c1·c2 |
| question_versions | jsonb | Snapshot of question IDs used |
| taken_at | timestamp | |

---

## Whiteboard layer (Phase 2)

### board_pages
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| session_id | uuid FK? | |
| tenant_id | uuid FK | |
| title | string? | |
| pattern | enum | blank · dotted · squared |
| background_color | string? | Hex |
| ruler_interval | int? | Snap grid px |
| position | int | |

### board_objects
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| page_id | uuid FK | |
| tenant_id | uuid FK | |
| object_type | enum | sticky · text · shape · activity · pdf · image · video |
| content | jsonb | Type-specific data |
| x, y | float | Canvas position |
| width, height | float | |
| rotation | float | default 0 |
| locked | bool | Position/size locked |
| z_index | int | Layer order |
| connector_from | uuid? | Shape connector source |
| connector_to | uuid? | Shape connector target |
| connector_anchors | jsonb? | {from: 'right', to: 'left'} |
| has_annotations | bool | Phase 3 |
| annotation_count | int | Phase 3 |
| current_page_num | int? | Phase 3 — PDF last pushed page |
| deleted_at | timestamp? | |

### board_strokes
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| page_id | uuid FK unique | One record per page |
| strokes_url | string? | S3/R2 binary blob URL |
| redis_key | string? | Live buffer key |
| last_flushed_at | timestamp? | |

---

## Assessment layer (Phase 2)

### submissions
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| activity_attempt_id | uuid FK | |
| student_id | uuid FK | |
| tenant_id | uuid FK | |
| status | enum | pending · graded · returned |
| response | jsonb | {text} or {audio_asset_id} |
| submitted_at | timestamp | |

### grades
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| submission_id | uuid FK unique | |
| graded_by | uuid FK | |
| score | float | |
| rubric_scores | jsonb? | Per-criterion scores |
| feedback_text | text? | |
| graded_at | timestamp | |

### rubric_templates
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK | |
| name | string | |
| criteria | jsonb | [{criterion, max_points}] |
| visibility | enum | private · public_template |

### media_assets
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK | |
| uploader_id | uuid FK | |
| asset_type | enum | image · pdf · audio · video_embed |
| s3_key | string? | null for embeds |
| size_bytes | bigint | 0 for embeds |
| metadata | jsonb | {waveform, thumbnail_key, embed_url, provider} |
| deleted_at | timestamp? | |

### follow_sessions
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| session_id | uuid FK | |
| teacher_id | uuid FK | |
| started_at | timestamp | |
| ended_at | timestamp? | |
| breaks_count | int | Times student broke free |

---

## Phase 3 — RT collaboration

### board_commands
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| page_id | uuid FK | |
| author_id | uuid FK | |
| sequence_num | bigint | Monotonic per page |
| command_type | enum | object_create·object_update·object_delete·stroke_add·stroke_erase |
| forward_payload | jsonb | What was applied |
| reverse_payload | jsonb | What undoes it |
| undone_at | timestamp? | null = active |
| created_at | timestamp | |

### pdf_annotations
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| object_id | uuid FK | board_objects |
| author_id | uuid FK | |
| tenant_id | uuid FK | |
| page_num | int | PDF page number |
| annotation_type | enum | stroke · comment · highlight |
| content | jsonb | Type-specific data |
| pdf_coords | jsonb | Normalised 0–1 coordinates |
| deleted_at | timestamp? | |

### annotation_strokes
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| object_id | uuid FK | |
| author_id | uuid FK | |
| page_num | int? | For PDFs |
| s3_key | string? | Flushed binary |
| redis_key | string? | Live buffer |
| last_flushed_at | timestamp? | |

---

## Phase 4 — AI + Analytics + Gamification

### ai_drafts
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK | |
| created_by | uuid FK | |
| capability | enum | full_lesson·activity·rubric·adapt·personalised_review·suggest_next |
| brief | jsonb | Input parameters |
| output | jsonb | Generated content |
| status | enum | pending · approved · discarded |
| prompt_version | string | e.g. "generate-lesson.v1" |
| tokens_used | int | |
| created_at | timestamp | |

### ai_generation_logs
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK | |
| draft_id | uuid FK? | |
| capability | enum | |
| model | string | claude-sonnet-4-6 |
| input_tokens | int | |
| output_tokens | int | |
| latency_ms | int | |
| created_at | timestamp | |

### ai_suggestions
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK | |
| student_id | uuid FK | |
| suggestions | jsonb | Array of 3 ranked suggestions |
| trigger | enum | auto · manual |
| status | enum | ready · accepted · dismissed |
| accepted_index | int? | |
| created_at | timestamp | |

### error_patterns
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid FK | |
| student_id | uuid FK | |
| skill_tag | string | e.g. "second_conditional" |
| attempt_count | int | |
| accuracy_pct | float | |
| window_days | int | default 30 |
| last_computed | timestamp | |

### badges (catalogue)
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| slug | string unique | e.g. "grammar-master" |
| name | string | |
| description | text | |
| trigger_type | string | e.g. "lesson_completed" |
| trigger_criteria | jsonb | Threshold data |
| icon_type | enum | svg_key · emoji |
| rarity | enum | common · rare · legendary |
| xp_reward | int | |
| visible_to_student | bool | |

### student_badges
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| student_id | uuid FK | |
| badge_id | uuid FK | |
| tenant_id | uuid FK | |
| earned_at | timestamp | |

### certificates
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| public_id | string unique | nanoid e.g. lex_b1_k7x2m |
| tenant_id | uuid FK | |
| student_id | uuid FK | |
| issued_by | uuid FK | |
| cefr_level | string | |
| target_language | string | |
| teacher_note | text? | |
| pdf_s3_key | string? | Generated on first download |
| issued_at | timestamp | |

### template_clones
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| source_course_id | uuid FK | |
| cloned_course_id | uuid FK | |
| cloned_by_tenant | uuid FK | |
| cloned_at | timestamp | |

---

## Redis-only structures (not in PostgreSQL)

| Key pattern | Type | TTL | Contents |
|---|---|---|---|
| `refresh:{token}` | string | 30d | userId |
| `otp:{email}` | string | 10min | 6-digit code |
| `lock:{objectId}` | string | 30s | JSON {userId, userName, color} |
| `strokes:{pageId}:buffer` | list | session | Stroke delta events |
| `replay:{pageId}` | list | 5min | Last 500 RT events |
| `seq:{pageId}` | int | - | Monotonic sequence counter |
| `presence:{pageId}` | hash | 5s | {userId: presenceData} |
| `hidden_strokes:{pageId}` | set | session | Stroke IDs to exclude on flush |
| `analytics:{type}:{id}` | string | 1hr | Cached analytics JSON |
| `metrics:{socketId}` | hash | session | Connection health data |
