-- AlterTable
ALTER TABLE `AccessRequest`
  ADD COLUMN `pollTokenHash` VARCHAR(255) NOT NULL,
  ADD COLUMN `deliveredAt` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `AccessRequest_pollTokenHash_idx` ON `AccessRequest`(`pollTokenHash`);
