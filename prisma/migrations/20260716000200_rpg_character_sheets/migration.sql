ALTER TABLE `Character`
  ADD COLUMN `sheet` JSON NULL;

UPDATE `Character`
SET `sheet` = JSON_OBJECT(
  'attributes', JSON_OBJECT('might', 1, 'agility', 1, 'wits', 1, 'spirit', 1),
  'maxVitality', 10,
  'maxFocus', 4,
  'inventory', JSON_ARRAY()
);

ALTER TABLE `Character`
  MODIFY `sheet` JSON NOT NULL;
