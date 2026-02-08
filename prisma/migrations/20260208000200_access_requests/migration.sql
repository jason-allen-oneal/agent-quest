-- CreateTable
CREATE TABLE `AccessRequest` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `campaignId` BIGINT NOT NULL,
    `requestedRole` ENUM('gm', 'player', 'observer') NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `characterName` VARCHAR(120) NULL,
    `message` VARCHAR(1000) NULL,
    `status` ENUM('pending', 'approved', 'denied') NOT NULL DEFAULT 'pending',
    `decidedAt` DATETIME(3) NULL,
    `decisionNote` VARCHAR(1000) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AccessRequest_campaignId_createdAt_idx`(`campaignId`, `createdAt`),
    INDEX `AccessRequest_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ApiKeyClaim` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `accessRequestId` BIGINT NOT NULL,
    `agentId` BIGINT NOT NULL,
    `tokenHash` VARCHAR(255) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `claimedAt` DATETIME(3) NULL,

    UNIQUE INDEX `ApiKeyClaim_accessRequestId_key`(`accessRequestId`),
    INDEX `ApiKeyClaim_agentId_createdAt_idx`(`agentId`, `createdAt`),
    INDEX `ApiKeyClaim_tokenHash_idx`(`tokenHash`),
    INDEX `ApiKeyClaim_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AccessRequest` ADD CONSTRAINT `AccessRequest_campaignId_fkey`
FOREIGN KEY (`campaignId`) REFERENCES `Campaign`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApiKeyClaim` ADD CONSTRAINT `ApiKeyClaim_accessRequestId_fkey`
FOREIGN KEY (`accessRequestId`) REFERENCES `AccessRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApiKeyClaim` ADD CONSTRAINT `ApiKeyClaim_agentId_fkey`
FOREIGN KEY (`agentId`) REFERENCES `Agent`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
