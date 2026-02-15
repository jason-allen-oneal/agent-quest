-- CreateTable
CREATE TABLE `Account` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `botId` VARCHAR(120) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `platformRole` ENUM('gm','player','observer') NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `Account_botId_key`(`botId`),
  INDEX `Account_platformRole_createdAt_idx`(`platformRole`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Add accountId to Agent
ALTER TABLE `Agent`
  ADD COLUMN `accountId` BIGINT NULL;

-- Backfill Account + Agent.accountId from legacy Agent rows.
-- NOTE: For legacy rows without botId, we create a synthetic botId: legacy-<agentId>
INSERT IGNORE INTO `Account` (`botId`, `name`, `platformRole`, `createdAt`)
  SELECT
    COALESCE(`botId`, CONCAT('legacy-', CAST(`id` AS CHAR))) AS `botId`,
    `name` AS `name`,
    `role` AS `platformRole`,
    `createdAt` AS `createdAt`
  FROM `Agent`;

UPDATE `Agent` a
JOIN `Account` ac
  ON ac.`botId` = COALESCE(a.`botId`, CONCAT('legacy-', CAST(a.`id` AS CHAR)))
SET a.`accountId` = ac.`id`;

-- Make Agent.accountId required + add uniqueness for membership
ALTER TABLE `Agent`
  MODIFY `accountId` BIGINT NOT NULL;

CREATE UNIQUE INDEX `Agent_accountId_campaignId_key` ON `Agent`(`accountId`, `campaignId`);
CREATE INDEX `Agent_accountId_createdAt_idx` ON `Agent`(`accountId`, `createdAt`);

-- ApiKey: move from agentId -> accountId
ALTER TABLE `ApiKey`
  ADD COLUMN `accountId` BIGINT NULL;

UPDATE `ApiKey` k
JOIN `Agent` a ON a.`id` = k.`agentId`
SET k.`accountId` = a.`accountId`;

ALTER TABLE `ApiKey`
  MODIFY `accountId` BIGINT NOT NULL,
  DROP FOREIGN KEY `ApiKey_agentId_fkey`,
  DROP COLUMN `agentId`;

CREATE INDEX `ApiKey_accountId_createdAt_idx` ON `ApiKey`(`accountId`, `createdAt`);

ALTER TABLE `ApiKey`
  ADD CONSTRAINT `ApiKey_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AccessRequest: platform-level (drop campaignId/characterName/agentId; add accountId)
ALTER TABLE `AccessRequest`
  ADD COLUMN `accountId` BIGINT NULL;

-- Backfill accountId from legacy approved requests
UPDATE `AccessRequest` ar
JOIN `Agent` a ON a.`id` = ar.`agentId`
SET ar.`accountId` = a.`accountId`;

ALTER TABLE `AccessRequest`
  MODIFY `botId` VARCHAR(120) NOT NULL,
  DROP FOREIGN KEY `AccessRequest_campaignId_fkey`,
  DROP COLUMN `campaignId`,
  DROP COLUMN `characterName`,
  DROP FOREIGN KEY `AccessRequest_agentId_fkey`,
  DROP COLUMN `agentId`;

CREATE INDEX `AccessRequest_accountId_createdAt_idx` ON `AccessRequest`(`accountId`, `createdAt`);
ALTER TABLE `AccessRequest`
  ADD CONSTRAINT `AccessRequest_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- ApiKeyClaim: move from agentId -> accountId
ALTER TABLE `ApiKeyClaim`
  ADD COLUMN `accountId` BIGINT NULL;

UPDATE `ApiKeyClaim` c
JOIN `Agent` a ON a.`id` = c.`agentId`
SET c.`accountId` = a.`accountId`;

ALTER TABLE `ApiKeyClaim`
  MODIFY `accountId` BIGINT NOT NULL,
  DROP FOREIGN KEY `ApiKeyClaim_agentId_fkey`,
  DROP COLUMN `agentId`;

CREATE INDEX `ApiKeyClaim_accountId_createdAt_idx` ON `ApiKeyClaim`(`accountId`, `createdAt`);
ALTER TABLE `ApiKeyClaim`
  ADD CONSTRAINT `ApiKeyClaim_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Drop legacy Agent.botId index+column
DROP INDEX `Agent_botId_createdAt_idx` ON `Agent`;
ALTER TABLE `Agent` DROP COLUMN `botId`;

-- CampaignInvite
CREATE TABLE `CampaignInvite` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `campaignId` BIGINT NOT NULL,
  `createdByAgentId` BIGINT NOT NULL,
  `codeHash` VARCHAR(255) NOT NULL,
  `remainingUses` INT NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `usedAt` DATETIME(3) NULL,
  `usedByAccountId` BIGINT NULL,

  UNIQUE INDEX `CampaignInvite_codeHash_key`(`codeHash`),
  INDEX `CampaignInvite_campaignId_createdAt_idx`(`campaignId`, `createdAt`),
  INDEX `CampaignInvite_createdByAgentId_createdAt_idx`(`createdByAgentId`, `createdAt`),
  INDEX `CampaignInvite_remainingUses_createdAt_idx`(`remainingUses`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CampaignInvite`
  ADD CONSTRAINT `CampaignInvite_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `Campaign`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `CampaignInvite_createdByAgentId_fkey` FOREIGN KEY (`createdByAgentId`) REFERENCES `Agent`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `CampaignInvite_usedByAccountId_fkey` FOREIGN KEY (`usedByAccountId`) REFERENCES `Account`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Agent.accountId foreign key
ALTER TABLE `Agent`
  ADD CONSTRAINT `Agent_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
