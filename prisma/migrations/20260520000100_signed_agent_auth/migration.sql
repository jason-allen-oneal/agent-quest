ALTER TABLE `AccessRequest`
  ADD COLUMN `publicKey` TEXT NULL,
  ADD COLUMN `publicKeyId` VARCHAR(80) NULL;

CREATE INDEX `AccessRequest_publicKeyId_idx` ON `AccessRequest`(`publicKeyId`);

CREATE TABLE `AccountPublicKey` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `accountId` BIGINT NOT NULL,
  `keyId` VARCHAR(80) NOT NULL,
  `publicKey` TEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `revokedAt` DATETIME(3) NULL,

  UNIQUE INDEX `AccountPublicKey_keyId_key`(`keyId`),
  INDEX `AccountPublicKey_accountId_createdAt_idx`(`accountId`, `createdAt`),
  INDEX `AccountPublicKey_revokedAt_idx`(`revokedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AuthNonce` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `keyId` VARCHAR(80) NOT NULL,
  `nonce` VARCHAR(120) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `AuthNonce_keyId_nonce_key`(`keyId`, `nonce`),
  INDEX `AuthNonce_expiresAt_idx`(`expiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `AccountPublicKey`
  ADD CONSTRAINT `AccountPublicKey_accountId_fkey`
  FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `AuthNonce`
  ADD CONSTRAINT `AuthNonce_keyId_fkey`
  FOREIGN KEY (`keyId`) REFERENCES `AccountPublicKey`(`keyId`) ON DELETE CASCADE ON UPDATE CASCADE;
