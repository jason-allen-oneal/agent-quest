-- AlterTable
ALTER TABLE `Agent`
  ADD COLUMN `botId` VARCHAR(120) NULL;

-- AlterTable
ALTER TABLE `AccessRequest`
  ADD COLUMN `botId` VARCHAR(120) NULL;

-- CreateIndex
CREATE INDEX `Agent_botId_createdAt_idx` ON `Agent`(`botId`, `createdAt`);

-- CreateIndex
CREATE INDEX `AccessRequest_botId_createdAt_idx` ON `AccessRequest`(`botId`, `createdAt`);
