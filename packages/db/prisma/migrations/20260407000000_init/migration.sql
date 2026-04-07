-- CreateEnum
CREATE TYPE "Role" AS ENUM ('teacher', 'student', 'system');

-- CreateEnum
CREATE TYPE "AgeGroup" AS ENUM ('adult', 'minor');

-- CreateEnum
CREATE TYPE "PlanSlug" AS ENUM ('free', 'pro', 'growth');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('private', 'public_template');

-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('draft', 'active', 'archived');

-- CreateEnum
CREATE TYPE "Framework" AS ENUM ('cefr', 'jlpt', 'hsk', 'custom');

-- CreateEnum
CREATE TYPE "CefrLevel" AS ENUM ('a1', 'a2', 'b1', 'b2', 'c1', 'c2');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('cloze', 'mcq', 'matching', 'ordering', 'open_writing', 'listening');

-- CreateEnum
CREATE TYPE "SrsMode" AS ENUM ('flashcard', 'mini_lesson');

-- CreateEnum
CREATE TYPE "ClassroomStatus" AS ENUM ('active', 'paused', 'archived');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('scheduled', 'active', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "ParticipantStatus" AS ENUM ('invited', 'joined', 'absent');

-- CreateEnum
CREATE TYPE "LessonProgressStatus" AS ENUM ('not_started', 'in_progress', 'completed');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('pending', 'graded', 'returned');

-- CreateEnum
CREATE TYPE "BoardPattern" AS ENUM ('blank', 'dotted', 'squared');

-- CreateEnum
CREATE TYPE "BoardObjectType" AS ENUM ('sticky', 'text', 'shape', 'activity', 'pdf', 'image', 'video');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('image', 'pdf', 'audio', 'video_embed');

-- CreateEnum
CREATE TYPE "CommandType" AS ENUM ('object_create', 'object_update', 'object_delete', 'stroke_add', 'stroke_erase');

-- CreateEnum
CREATE TYPE "AnnotationType" AS ENUM ('stroke', 'comment', 'highlight');

-- CreateEnum
CREATE TYPE "AiCapability" AS ENUM ('full_lesson', 'activity', 'rubric', 'adapt_lesson', 'personalised_review', 'suggest_next');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('pending_review', 'approved', 'discarded');

-- CreateEnum
CREATE TYPE "SuggestionTrigger" AS ENUM ('auto', 'manual');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('ready', 'accepted', 'dismissed');

-- CreateEnum
CREATE TYPE "UpgradeRequestStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "TenantMemberRole" AS ENUM ('owner', 'teacher', 'admin');

-- CreateEnum
CREATE TYPE "TenantMemberStatus" AS ENUM ('invited', 'active', 'removed');

-- CreateEnum
CREATE TYPE "BadgeRarity" AS ENUM ('common', 'rare', 'legendary');

-- CreateEnum
CREATE TYPE "BadgeIconType" AS ENUM ('svg_key', 'emoji');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "stripe_customer_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "plan_slug" "PlanSlug" NOT NULL DEFAULT 'free',
    "student_limit" INTEGER,
    "lesson_plan_limit" INTEGER,
    "ai_credits_remaining" INTEGER NOT NULL DEFAULT 0,
    "storage_limit_bytes" BIGINT,
    "feature_flags" JSONB NOT NULL DEFAULT '{}',
    "renews_at" TIMESTAMP(3),
    "grace_period_until" TIMESTAMP(3),

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'student',
    "age_group" "AgeGroup",
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passkey_credentials" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "credential_id" BYTEA NOT NULL,
    "public_key" BYTEA NOT NULL,
    "sign_count" INTEGER NOT NULL,
    "device_label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "passkey_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL,
    "policy_version" TEXT NOT NULL,
    "ip_address" TEXT NOT NULL,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "teacher_language" TEXT,
    "bio" TEXT,

    CONSTRAINT "teacher_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "cefr_level" "CefrLevel",
    "streak_days" INTEGER NOT NULL DEFAULT 0,
    "streak_grace_used_at" TIMESTAMP(3),
    "disengagement_flag" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "xp_total" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "student_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "target_language" TEXT NOT NULL DEFAULT 'en',
    "framework" "Framework" NOT NULL DEFAULT 'cefr',
    "target_level" TEXT NOT NULL DEFAULT 'b1',
    "teacher_language" TEXT,
    "visibility" "Visibility" NOT NULL DEFAULT 'private',
    "status" "CourseStatus" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lessons" (
    "id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT,
    "position" INTEGER NOT NULL,
    "estimated_minutes" INTEGER,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" TEXT NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "scoring_rules" JSONB,
    "skill_tags" TEXT[],
    "srs_mode" "SrsMode",
    "media_asset_id" TEXT,
    "rubric_template_id" TEXT,
    "image_url" TEXT,
    "visibility" "Visibility" NOT NULL DEFAULT 'private',
    "version" INTEGER NOT NULL DEFAULT 1,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_clones" (
    "id" TEXT NOT NULL,
    "source_course_id" TEXT NOT NULL,
    "cloned_course_id" TEXT NOT NULL,
    "cloned_by_tenant" TEXT NOT NULL,
    "cloned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "template_clones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classrooms" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "teacher_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "course_id" TEXT,
    "status" "ClassroomStatus" NOT NULL DEFAULT 'active',

    CONSTRAINT "classrooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" TEXT NOT NULL,
    "classroom_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "enrolled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "teacher_id" TEXT NOT NULL,
    "student_id" TEXT,
    "classroom_id" TEXT,
    "status" "SessionStatus" NOT NULL DEFAULT 'scheduled',
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "duration_secs" INTEGER,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_participants" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3),
    "left_at" TIMESTAMP(3),
    "status" "ParticipantStatus" NOT NULL DEFAULT 'invited',

    CONSTRAINT "session_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_progress" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "status" "LessonProgressStatus" NOT NULL DEFAULT 'not_started',
    "score_pct" DOUBLE PRECISION,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "lesson_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_attempts" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "activity_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "score" DOUBLE PRECISION,
    "response" JSONB,
    "attempted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "annotation_stroke_key" TEXT,
    "annotation_comments" JSONB,

    CONSTRAINT "activity_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "srs_items" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "activity_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "srs_mode" "SrsMode" NOT NULL,
    "ease_factor" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "interval_days" INTEGER NOT NULL DEFAULT 1,
    "next_review" DATE NOT NULL,
    "activity_version" INTEGER NOT NULL,
    "repetitions" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "srs_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "placement_tests" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "result_level" "CefrLevel" NOT NULL,
    "question_versions" JSONB NOT NULL,
    "taken_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "placement_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upgrade_requests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "target_plan" "PlanSlug" NOT NULL,
    "motivation" TEXT NOT NULL,
    "status" "UpgradeRequestStatus" NOT NULL DEFAULT 'pending',
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upgrade_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "stripe_event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_snapshots" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "student_count" INTEGER NOT NULL,
    "course_count" INTEGER NOT NULL,
    "storage_bytes" BIGINT NOT NULL,
    "ai_credits_used" INTEGER NOT NULL,
    "sessions_count" INTEGER NOT NULL,

    CONSTRAINT "usage_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_members" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "TenantMemberRole" NOT NULL DEFAULT 'teacher',
    "invited_by" TEXT,
    "joined_at" TIMESTAMP(3),
    "status" "TenantMemberStatus" NOT NULL DEFAULT 'invited',

    CONSTRAINT "tenant_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" TEXT NOT NULL,
    "activity_attempt_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'pending',
    "response" JSONB NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grades" (
    "id" TEXT NOT NULL,
    "submission_id" TEXT NOT NULL,
    "graded_by" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "rubric_scores" JSONB,
    "feedback_text" TEXT,
    "graded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rubric_templates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "visibility" "Visibility" NOT NULL DEFAULT 'private',

    CONSTRAINT "rubric_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "uploader_id" TEXT NOT NULL,
    "asset_type" "AssetType" NOT NULL,
    "s3_key" TEXT,
    "size_bytes" BIGINT NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_pages" (
    "id" TEXT NOT NULL,
    "session_id" TEXT,
    "tenant_id" TEXT NOT NULL,
    "title" TEXT,
    "pattern" "BoardPattern" NOT NULL DEFAULT 'dotted',
    "background_color" TEXT,
    "ruler_interval" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "board_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_objects" (
    "id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "object_type" "BoardObjectType" NOT NULL,
    "content" JSONB NOT NULL,
    "x" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "y" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "width" DOUBLE PRECISION NOT NULL DEFAULT 200,
    "height" DOUBLE PRECISION NOT NULL DEFAULT 150,
    "rotation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "z_index" INTEGER NOT NULL DEFAULT 0,
    "connector_from" TEXT,
    "connector_to" TEXT,
    "connector_anchors" JSONB,
    "has_annotations" BOOLEAN NOT NULL DEFAULT false,
    "annotation_count" INTEGER NOT NULL DEFAULT 0,
    "current_page_num" INTEGER,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "board_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_strokes" (
    "id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "strokes_url" TEXT,
    "redis_key" TEXT,
    "last_flushed_at" TIMESTAMP(3),

    CONSTRAINT "board_strokes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_sessions" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "teacher_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "breaks_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "follow_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_commands" (
    "id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "sequence_num" BIGINT NOT NULL,
    "command_type" "CommandType" NOT NULL,
    "forward_payload" JSONB NOT NULL,
    "reverse_payload" JSONB NOT NULL,
    "undone_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pdf_annotations" (
    "id" TEXT NOT NULL,
    "object_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "page_num" INTEGER NOT NULL,
    "annotation_type" "AnnotationType" NOT NULL,
    "content" JSONB NOT NULL,
    "pdf_coords" JSONB NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pdf_annotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "annotation_strokes" (
    "id" TEXT NOT NULL,
    "object_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "page_num" INTEGER,
    "s3_key" TEXT,
    "redis_key" TEXT,
    "last_flushed_at" TIMESTAMP(3),

    CONSTRAINT "annotation_strokes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_drafts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "capability" "AiCapability" NOT NULL,
    "brief" JSONB NOT NULL,
    "output" JSONB NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'pending_review',
    "prompt_version" TEXT NOT NULL,
    "tokens_used" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_generation_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "draft_id" TEXT,
    "capability" "AiCapability" NOT NULL,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_generation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_suggestions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "suggestions" JSONB NOT NULL,
    "trigger" "SuggestionTrigger" NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'ready',
    "accepted_index" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_patterns" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "skill_tag" TEXT NOT NULL,
    "attempt_count" INTEGER NOT NULL,
    "accuracy_pct" DOUBLE PRECISION NOT NULL,
    "window_days" INTEGER NOT NULL DEFAULT 30,
    "last_computed" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "error_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "badges" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "trigger_type" TEXT NOT NULL,
    "trigger_criteria" JSONB NOT NULL,
    "icon_type" "BadgeIconType" NOT NULL,
    "rarity" "BadgeRarity" NOT NULL DEFAULT 'common',
    "xp_reward" INTEGER NOT NULL DEFAULT 0,
    "visible_to_student" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_badges" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "badge_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "earned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" TEXT NOT NULL,
    "public_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "issued_by" TEXT NOT NULL,
    "cefr_level" TEXT NOT NULL,
    "target_language" TEXT NOT NULL,
    "teacher_note" TEXT,
    "pdf_s3_key" TEXT,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_tenant_id_key" ON "subscriptions"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "passkey_credentials_credential_id_key" ON "passkey_credentials"("credential_id");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_profiles_user_id_key" ON "teacher_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_profiles_user_id_key" ON "student_profiles"("user_id");

-- CreateIndex
CREATE INDEX "courses_tenant_id_visibility_idx" ON "courses"("tenant_id", "visibility");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_classroom_id_student_id_key" ON "enrollments"("classroom_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_progress_student_id_lesson_id_key" ON "lesson_progress"("student_id", "lesson_id");

-- CreateIndex
CREATE INDEX "activity_attempts_student_id_attempted_at_correct_idx" ON "activity_attempts"("student_id", "attempted_at", "correct");

-- CreateIndex
CREATE INDEX "srs_items_student_id_next_review_idx" ON "srs_items"("student_id", "next_review");

-- CreateIndex
CREATE UNIQUE INDEX "billing_events_stripe_event_id_key" ON "billing_events"("stripe_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "usage_snapshots_tenant_id_snapshot_date_key" ON "usage_snapshots"("tenant_id", "snapshot_date");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_activity_attempt_id_key" ON "submissions"("activity_attempt_id");

-- CreateIndex
CREATE UNIQUE INDEX "grades_submission_id_key" ON "grades"("submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "board_strokes_page_id_key" ON "board_strokes"("page_id");

-- CreateIndex
CREATE INDEX "board_commands_page_id_sequence_num_idx" ON "board_commands"("page_id", "sequence_num");

-- CreateIndex
CREATE UNIQUE INDEX "ai_generation_logs_draft_id_key" ON "ai_generation_logs"("draft_id");

-- CreateIndex
CREATE UNIQUE INDEX "error_patterns_tenant_id_student_id_skill_tag_key" ON "error_patterns"("tenant_id", "student_id", "skill_tag");

-- CreateIndex
CREATE UNIQUE INDEX "badges_slug_key" ON "badges"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "student_badges_student_id_badge_id_key" ON "student_badges"("student_id", "badge_id");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_public_id_key" ON "certificates"("public_id");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passkey_credentials" ADD CONSTRAINT "passkey_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_profiles" ADD CONSTRAINT "teacher_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_clones" ADD CONSTRAINT "template_clones_source_course_id_fkey" FOREIGN KEY ("source_course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_clones" ADD CONSTRAINT "template_clones_cloned_course_id_fkey" FOREIGN KEY ("cloned_course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_classroom_id_fkey" FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_classroom_id_fkey" FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_participants" ADD CONSTRAINT "session_participants_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_attempts" ADD CONSTRAINT "activity_attempts_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "srs_items" ADD CONSTRAINT "srs_items_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "srs_items" ADD CONSTRAINT "srs_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upgrade_requests" ADD CONSTRAINT "upgrade_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_snapshots" ADD CONSTRAINT "usage_snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_activity_attempt_id_fkey" FOREIGN KEY ("activity_attempt_id") REFERENCES "activity_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_pages" ADD CONSTRAINT "board_pages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_objects" ADD CONSTRAINT "board_objects_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "board_pages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_strokes" ADD CONSTRAINT "board_strokes_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "board_pages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_sessions" ADD CONSTRAINT "follow_sessions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_commands" ADD CONSTRAINT "board_commands_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "board_pages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdf_annotations" ADD CONSTRAINT "pdf_annotations_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "board_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annotation_strokes" ADD CONSTRAINT "annotation_strokes_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "board_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_drafts" ADD CONSTRAINT "ai_drafts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generation_logs" ADD CONSTRAINT "ai_generation_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generation_logs" ADD CONSTRAINT "ai_generation_logs_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "ai_drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "error_patterns" ADD CONSTRAINT "error_patterns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_badges" ADD CONSTRAINT "student_badges_badge_id_fkey" FOREIGN KEY ("badge_id") REFERENCES "badges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

