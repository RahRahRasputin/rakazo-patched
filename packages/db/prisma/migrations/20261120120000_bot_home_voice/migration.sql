ALTER TABLE "bots" ADD COLUMN "voiceTone" TEXT;
ALTER TABLE "bots" ADD COLUMN "welcomeHome" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "bots" ADD COLUMN "roomNoticeRatio" DOUBLE PRECISION;
ALTER TABLE "bots" ADD COLUMN "roomUrgentRatio" DOUBLE PRECISION;

ALTER TABLE "bots" ADD CONSTRAINT "bots_voice_tone_check"
  CHECK ("voiceTone" IS NULL OR "voiceTone" IN ('natural', 'river-time'));

ALTER TABLE "bots" ADD CONSTRAINT "bots_room_ratio_check"
  CHECK (
    ("roomNoticeRatio" IS NULL OR ("roomNoticeRatio" > 0 AND "roomNoticeRatio" <= 1))
    AND ("roomUrgentRatio" IS NULL OR ("roomUrgentRatio" > 0 AND "roomUrgentRatio" <= 1))
    AND (
      "roomNoticeRatio" IS NULL
      OR "roomUrgentRatio" IS NULL
      OR "roomNoticeRatio" < "roomUrgentRatio"
    )
  );
