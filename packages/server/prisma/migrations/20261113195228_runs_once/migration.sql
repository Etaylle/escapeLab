-- DropIndex
DROP INDEX "runs_mission_id_difficulty_outcome_idx";

-- CreateIndex
CREATE UNIQUE INDEX "runs_room_code_started_at_key" ON "runs"("room_code", "started_at");

