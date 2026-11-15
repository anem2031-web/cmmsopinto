-- Apply manually to the database used by the CMMS deployment.
SELECT DATABASE() AS current_database;

CREATE TABLE IF NOT EXISTS `catalog_integration_tokens` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL,
  `tokenHash` VARCHAR(64) NOT NULL,
  `createdById` INT NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `revokedById` INT NULL,
  `revokedAt` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `catalog_integration_token_hash_uq` (`tokenHash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
