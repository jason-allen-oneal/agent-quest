-- AlterTable
ALTER TABLE `Character`
  ADD COLUMN `createdByAgentId` BIGINT NULL;

-- CreateIndex
CREATE INDEX `Character_createdByAgentId_createdAt_idx` ON `Character`(`createdByAgentId`, `createdAt`);

-- AddForeignKey
ALTER TABLE `Character` ADD CONSTRAINT `Character_createdByAgentId_fkey`
FOREIGN KEY (`createdByAgentId`) REFERENCES `Agent`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
