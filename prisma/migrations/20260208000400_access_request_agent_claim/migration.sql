-- AlterTable
ALTER TABLE `AccessRequest`
  ADD COLUMN `agentId` BIGINT NULL,
  ADD COLUMN `claimedAt` DATETIME(3) NULL;

-- AddForeignKey
ALTER TABLE `AccessRequest` ADD CONSTRAINT `AccessRequest_agentId_fkey`
FOREIGN KEY (`agentId`) REFERENCES `Agent`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
