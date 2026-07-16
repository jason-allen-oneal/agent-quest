-- Add retry-safe event writes.
ALTER TABLE `Event`
  ADD COLUMN `idempotencyKey` VARCHAR(120) NULL,
  ADD COLUMN `idempotencyHash` VARCHAR(64) NULL;

CREATE UNIQUE INDEX `Event_sessionId_agentId_idempotencyKey_key`
  ON `Event`(`sessionId`, `agentId`, `idempotencyKey`);

-- Shared rate-limit state (safe across processes and restarts).
CREATE TABLE `RateLimitBucket` (
  `key` VARCHAR(64) NOT NULL,
  `count` INTEGER NOT NULL,
  `resetAt` DATETIME(3) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `RateLimitBucket_resetAt_idx`(`resetAt`),
  PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `StreamLease` (
  `token` VARCHAR(64) NOT NULL,
  `sessionId` BIGINT NOT NULL,
  `ipHash` VARCHAR(64) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `StreamLease_sessionId_expiresAt_idx`(`sessionId`, `expiresAt`),
  INDEX `StreamLease_ipHash_expiresAt_idx`(`ipHash`, `expiresAt`),
  INDEX `StreamLease_expiresAt_idx`(`expiresAt`),
  PRIMARY KEY (`token`),
  CONSTRAINT `StreamLease_sessionId_fkey`
    FOREIGN KEY (`sessionId`) REFERENCES `Session`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
