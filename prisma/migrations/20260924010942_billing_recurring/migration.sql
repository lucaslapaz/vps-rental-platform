-- AlterTable
ALTER TABLE `invoices` ADD COLUMN `kind` ENUM('CREATION', 'RENEWAL', 'UPGRADE') NOT NULL DEFAULT 'CREATION';

-- AlterTable
ALTER TABLE `vps` ADD COLUMN `paidUntil` DATETIME(3) NULL;

-- Backfill (Fase 10): faturas de troca de plano existentes e fim do período das VPS já pagas
-- (30 dias a partir do pagamento da fatura de criação).
UPDATE `invoices` SET `kind` = 'UPGRADE' WHERE `description` LIKE '%(proporcional)%';
UPDATE `vps` v SET `paidUntil` = (
  SELECT DATE_ADD(MIN(i.`paidAt`), INTERVAL 30 DAY) FROM `invoices` i
  WHERE i.`vpsId` = v.`id` AND i.`status` = 'PAID' AND i.`kind` = 'CREATION'
) WHERE v.`deletedAt` IS NULL;
