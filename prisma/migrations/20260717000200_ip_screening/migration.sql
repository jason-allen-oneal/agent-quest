-- Add durable campaign policy state and append-only IP screening evidence.
ALTER TABLE `Campaign`
  ADD COLUMN `rightsStatus` VARCHAR(64) NOT NULL DEFAULT 'screening_evidence_recorded',
  ADD COLUMN `contentPolicyVersion` VARCHAR(64) NOT NULL DEFAULT 'original-or-authorized-v2';

CREATE TABLE `ContentReview` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `campaignId` BIGINT NOT NULL,
  `characterId` BIGINT NULL,
  `eventId` BIGINT NULL,
  `accountId` BIGINT NULL,
  `agentId` BIGINT NULL,
  `surface` VARCHAR(80) NOT NULL,
  `subjectHash` VARCHAR(64) NOT NULL,
  `decision` VARCHAR(64) NOT NULL,
  `rightsBasis` VARCHAR(32) NOT NULL,
  `policyVersion` VARCHAR(64) NOT NULL,
  `checkedAt` DATETIME(3) NOT NULL,
  `evidence` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `ContentReview_campaignId_createdAt_idx`(`campaignId`, `createdAt`),
  INDEX `ContentReview_characterId_createdAt_idx`(`characterId`, `createdAt`),
  INDEX `ContentReview_agentId_createdAt_idx`(`agentId`, `createdAt`),
  INDEX `ContentReview_surface_createdAt_idx`(`surface`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ContentReview`
  ADD CONSTRAINT `ContentReview_campaignId_fkey`
    FOREIGN KEY (`campaignId`) REFERENCES `Campaign`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `ContentReview_characterId_fkey`
    FOREIGN KEY (`characterId`) REFERENCES `Character`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `ContentReview_eventId_fkey`
    FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `ContentReview_accountId_fkey`
    FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `ContentReview_agentId_fkey`
    FOREIGN KEY (`agentId`) REFERENCES `Agent`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
