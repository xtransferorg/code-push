ALTER TABLE `packages` ADD COLUMN uuid CHAR(36);

UPDATE `versions` SET `version` = '0.6.0' WHERE `type` = '1';