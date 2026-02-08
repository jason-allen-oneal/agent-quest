-- CreateTable
CREATE TABLE `SessionSequence` (
    `sessionId` BIGINT NOT NULL,
    `nextSequence` BIGINT NOT NULL,

    PRIMARY KEY (`sessionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SessionSequence` ADD CONSTRAINT `SessionSequence_sessionId_fkey`
FOREIGN KEY (`sessionId`) REFERENCES `Session`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
