-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "display_name" TEXT NOT NULL DEFAULT '',
    "colour" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identities" (
    "provider" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "secret_hash" TEXT,
    "account_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identities_pkey" PRIMARY KEY ("provider","subject")
);

-- CreateTable
CREATE TABLE "runs" (
    "id" UUID NOT NULL,
    "mission_id" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "seed" BIGINT,
    "room_code" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3) NOT NULL,
    "duration_sec" DOUBLE PRECISION NOT NULL,
    "crew_size" INTEGER NOT NULL,
    "alarms" INTEGER NOT NULL,
    "daily" BOOLEAN NOT NULL DEFAULT false,
    "report" JSONB NOT NULL,

    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_members" (
    "run_id" UUID NOT NULL,
    "seat" INTEGER NOT NULL,
    "account_id" UUID,
    "seat_name" TEXT NOT NULL,
    "contributions" JSONB NOT NULL,

    CONSTRAINT "run_members_pkey" PRIMARY KEY ("run_id","seat")
);

-- CreateTable
CREATE TABLE "achievements" (
    "account_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "unlocked_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "achievements_pkey" PRIMARY KEY ("account_id","key")
);

-- CreateIndex
CREATE INDEX "identities_account_id_idx" ON "identities"("account_id");

-- CreateIndex
CREATE INDEX "runs_mission_id_difficulty_outcome_idx" ON "runs"("mission_id", "difficulty", "outcome");

-- CreateIndex
CREATE INDEX "run_members_account_id_idx" ON "run_members"("account_id");

-- AddForeignKey
ALTER TABLE "identities" ADD CONSTRAINT "identities_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_members" ADD CONSTRAINT "run_members_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_members" ADD CONSTRAINT "run_members_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
