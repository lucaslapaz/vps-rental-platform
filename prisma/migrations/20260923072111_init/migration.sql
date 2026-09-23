-- CreateTable
CREATE TABLE `users` (
    `id` CHAR(36) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `roleId` INTEGER NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    INDEX `users_roleId_idx`(`roleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(50) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(255) NULL,
    `isSystem` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `roles_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(100) NOT NULL,
    `description` VARCHAR(255) NOT NULL,

    UNIQUE INDEX `permissions_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `roleId` INTEGER NOT NULL,
    `permissionId` INTEGER NOT NULL,

    INDEX `role_permissions_permissionId_idx`(`permissionId`),
    PRIMARY KEY (`roleId`, `permissionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `id` CHAR(36) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `absoluteExpiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `ip` VARCHAR(45) NULL,
    `userAgent` VARCHAR(512) NULL,

    UNIQUE INDEX `sessions_tokenHash_key`(`tokenHash`),
    INDEX `sessions_userId_idx`(`userId`),
    INDEX `sessions_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ssh_keys` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` CHAR(36) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `publicKey` TEXT NOT NULL,
    `fingerprint` VARCHAR(100) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ssh_keys_userId_fingerprint_key`(`userId`, `fingerprint`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plans` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `slug` VARCHAR(40) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `cores` INTEGER NOT NULL,
    `memoryMb` INTEGER NOT NULL,
    `diskGb` INTEGER NOT NULL,
    `bandwidthMbps` INTEGER NOT NULL,
    `priceCents` INTEGER NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `plans_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `os_templates` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `slug` VARCHAR(40) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `pveTemplateVmid` INTEGER NOT NULL,
    `defaultUser` VARCHAR(32) NOT NULL,
    `family` VARCHAR(20) NOT NULL,
    `version` VARCHAR(20) NOT NULL,
    `sudoCommand` VARCHAR(10) NOT NULL,
    `minMemoryMb` INTEGER NOT NULL,
    `minDiskGb` INTEGER NOT NULL,
    `supportsRootPassword` BOOLEAN NOT NULL DEFAULT true,
    `supportsSshKeys` BOOLEAN NOT NULL DEFAULT true,
    `requiresPassword` BOOLEAN NOT NULL DEFAULT false,
    `hasGui` BOOLEAN NOT NULL DEFAULT false,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `os_templates_slug_key`(`slug`),
    UNIQUE INDEX `os_templates_pveTemplateVmid_key`(`pveTemplateVmid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ip_addresses` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `address` VARCHAR(45) NOT NULL,
    `prefix` INTEGER NOT NULL,
    `gateway` VARCHAR(45) NOT NULL,
    `macAddress` CHAR(17) NOT NULL,
    `status` ENUM('FREE', 'RESERVED', 'ASSIGNED') NOT NULL DEFAULT 'FREE',
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ip_addresses_address_key`(`address`),
    UNIQUE INDEX `ip_addresses_macAddress_key`(`macAddress`),
    INDEX `ip_addresses_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vps` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `planId` INTEGER NOT NULL,
    `osTemplateId` INTEGER NOT NULL,
    `hostname` VARCHAR(63) NOT NULL,
    `username` VARCHAR(32) NOT NULL,
    `sshPasswordAuth` BOOLEAN NOT NULL DEFAULT false,
    `rootPasswordSet` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('PENDING_PAYMENT', 'PROVISIONING', 'RUNNING', 'STOPPED', 'STARTING', 'STOPPING', 'REBOOTING', 'UPDATING', 'DELETING', 'DELETED', 'SUSPENDED', 'ERROR') NOT NULL DEFAULT 'PENDING_PAYMENT',
    `cores` INTEGER NOT NULL,
    `memoryMb` INTEGER NOT NULL,
    `diskGb` INTEGER NOT NULL,
    `bandwidthMbps` INTEGER NOT NULL,
    `pveNode` VARCHAR(64) NULL,
    `pveVmid` INTEGER NULL,
    `ipAddressId` INTEGER NULL,
    `lastError` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `vps_pveVmid_key`(`pveVmid`),
    UNIQUE INDEX `vps_ipAddressId_key`(`ipAddressId`),
    INDEX `vps_userId_status_idx`(`userId`, `status`),
    INDEX `vps_planId_idx`(`planId`),
    INDEX `vps_osTemplateId_idx`(`osTemplateId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vps_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `vpsId` CHAR(36) NOT NULL,
    `actorId` CHAR(36) NULL,
    `action` VARCHAR(40) NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `pveUpid` VARCHAR(255) NULL,
    `message` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `vps_events_vpsId_createdAt_idx`(`vpsId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoices` (
    `id` CHAR(36) NOT NULL,
    `number` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` CHAR(36) NOT NULL,
    `vpsId` CHAR(36) NULL,
    `description` VARCHAR(255) NOT NULL,
    `amountCents` INTEGER NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'BRL',
    `status` ENUM('PENDING', 'PAID', 'FAILED', 'CANCELED') NOT NULL DEFAULT 'PENDING',
    `periodStart` DATETIME(3) NULL,
    `periodEnd` DATETIME(3) NULL,
    `dueAt` DATETIME(3) NOT NULL,
    `paidAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `invoices_number_key`(`number`),
    INDEX `invoices_userId_status_idx`(`userId`, `status`),
    INDEX `invoices_vpsId_idx`(`vpsId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payments` (
    `id` CHAR(36) NOT NULL,
    `invoiceId` CHAR(36) NOT NULL,
    `status` ENUM('APPROVED', 'DECLINED') NOT NULL,
    `amountCents` INTEGER NOT NULL,
    `cardBrand` VARCHAR(20) NOT NULL,
    `cardLast4` CHAR(4) NOT NULL,
    `gatewayReference` VARCHAR(64) NOT NULL,
    `failureCode` VARCHAR(40) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payments_invoiceId_idx`(`invoiceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `jobs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `type` VARCHAR(50) NOT NULL,
    `payload` JSON NOT NULL,
    `status` ENUM('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `maxAttempts` INTEGER NOT NULL DEFAULT 5,
    `runAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lockedAt` DATETIME(3) NULL,
    `lockedBy` VARCHAR(64) NULL,
    `lastError` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `jobs_status_runAt_idx`(`status`, `runAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `support_conversations` (
    `id` CHAR(36) NOT NULL,
    `customerId` CHAR(36) NOT NULL,
    `agentId` CHAR(36) NULL,
    `subject` VARCHAR(150) NOT NULL,
    `status` ENUM('WAITING', 'ACTIVE', 'CLOSED') NOT NULL DEFAULT 'WAITING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `claimedAt` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,

    INDEX `support_conversations_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `support_conversations_customerId_status_idx`(`customerId`, `status`),
    INDEX `support_conversations_agentId_status_idx`(`agentId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `support_messages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `conversationId` CHAR(36) NOT NULL,
    `senderId` CHAR(36) NULL,
    `body` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `support_messages_conversationId_id_idx`(`conversationId`, `id`),
    INDEX `support_messages_senderId_idx`(`senderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `actorId` CHAR(36) NULL,
    `action` VARCHAR(60) NOT NULL,
    `targetType` VARCHAR(40) NULL,
    `targetId` VARCHAR(64) NULL,
    `metadata` JSON NULL,
    `ip` VARCHAR(45) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_action_createdAt_idx`(`action`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `permissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ssh_keys` ADD CONSTRAINT `ssh_keys_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vps` ADD CONSTRAINT `vps_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vps` ADD CONSTRAINT `vps_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `plans`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vps` ADD CONSTRAINT `vps_osTemplateId_fkey` FOREIGN KEY (`osTemplateId`) REFERENCES `os_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vps` ADD CONSTRAINT `vps_ipAddressId_fkey` FOREIGN KEY (`ipAddressId`) REFERENCES `ip_addresses`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vps_events` ADD CONSTRAINT `vps_events_vpsId_fkey` FOREIGN KEY (`vpsId`) REFERENCES `vps`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_vpsId_fkey` FOREIGN KEY (`vpsId`) REFERENCES `vps`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `invoices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `support_conversations` ADD CONSTRAINT `support_conversations_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `support_conversations` ADD CONSTRAINT `support_conversations_agentId_fkey` FOREIGN KEY (`agentId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `support_messages` ADD CONSTRAINT `support_messages_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `support_conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `support_messages` ADD CONSTRAINT `support_messages_senderId_fkey` FOREIGN KEY (`senderId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
