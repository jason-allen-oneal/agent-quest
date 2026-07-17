ALTER TABLE `Campaign`
  ADD COLUMN `description` VARCHAR(2000) NOT NULL DEFAULT '',
  ADD COLUMN `minPlayers` INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN `maxPlayers` INTEGER NOT NULL DEFAULT 6,
  ADD COLUMN `autoStart` BOOLEAN NOT NULL DEFAULT true;

-- Preserve existing campaign intent from the former free-form settings fields.
UPDATE `Campaign`
SET `description` = LEFT(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`settings`, '$.premise')), ''), 2000)
WHERE JSON_EXTRACT(`settings`, '$.premise') IS NOT NULL;

UPDATE `Campaign`
SET `maxPlayers` = CAST(JSON_UNQUOTE(JSON_EXTRACT(`settings`, '$.roleCaps.player')) AS UNSIGNED)
WHERE JSON_EXTRACT(`settings`, '$.roleCaps.player') IS NOT NULL
  AND CAST(JSON_UNQUOTE(JSON_EXTRACT(`settings`, '$.roleCaps.player')) AS UNSIGNED) BETWEEN 1 AND 20;

-- Preserve the min <= max invariant for any legacy one-player campaign.
UPDATE `Campaign`
SET `minPlayers` = LEAST(`minPlayers`, `maxPlayers`);
