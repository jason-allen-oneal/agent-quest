ALTER TABLE `Campaign`
  ADD COLUMN `publicCharter` JSON NULL,
  ADD COLUMN `gmDirective` JSON NULL,
  ADD COLUMN `directiveVersion` VARCHAR(64) NULL,
  ADD COLUMN `directiveHash` VARCHAR(64) NULL;

UPDATE `Campaign`
SET
  `publicCharter` = JSON_OBJECT(),
  `gmDirective` = JSON_OBJECT(),
  `directiveVersion` = 'v1',
  `directiveHash` = '70ffde4760ffcc4f9d254d972484d3d77e1cc0ae3de01f62075d3d7dd39213c2';

UPDATE `Campaign`
SET
  `publicCharter` = JSON_OBJECT(
    'campaignPromise', 'A drowned cathedral broadcasts testimonies in the voices of the dead. The party must decide what truth is worth saving before the flood reaches the settlement.',
    'playerAgency', 'There is no hidden correct ending. The campaign responds to what the agents protect, reveal, suppress, and sacrifice.',
    'knownPremise', 'The cathedral is a physical flooded place with failing structures, contested history, and human stakes.'
  ),
  `gmDirective` = JSON_OBJECT(
    'campaignPromise', 'A drowned cathedral broadcasts testimonies in the voices of the dead. The party must decide what truth is worth saving before the flood reaches the settlement.',
    'hiddenTruth', 'A submerged bell-and-script memorial mechanism preserves final testimony. Its warnings are conditional readings of recorded testimony, present movement, and nearby choices; it is damaged and not omniscient.',
    'factions', JSON_ARRAY(
      'Living investigators want answers, survival, and control over what the cathedral reveals.',
      'The recorded dead are contradictory testimonies, not one unified ghost.',
      'Keepers and successors want the mechanism contained or reclaimed because public testimony threatens old obligations and power.',
      'The mire and flood impose physical deadlines rather than acting as a villain.'
    ),
    'escalationClock', JSON_ARRAY('stronger current and shifting stone', 'lost routes and damaged supplies', 'voices bleeding into nearby water', 'structural failure', 'a forced choice between the mechanism, evidence, and people above'),
    'investigationRules', JSON_ARRAY('Keep the pale script, bell, current, and maintenance passage connected.', 'Give major truths multiple discovery routes.', 'Failures cost time, position, safety, trust, or evidence without erasing the only path to the central truth.', 'Do not introduce a surprise mastermind, chosen-one exception, or arbitrary prophecy to force a plot.'),
    'possibleEndings', JSON_ARRAY('release', 'silence', 'containment', 'destruction', 'failure')
  ),
  `directiveVersion` = 'cathedral-v1',
  `directiveHash` = 'f5a67e96badfce67286903bc8b9d6cc98ffa61d92c32072a30bf7cd7caf704cc'
WHERE `id` = 1;

ALTER TABLE `Campaign`
  MODIFY `publicCharter` JSON NOT NULL,
  MODIFY `gmDirective` JSON NOT NULL,
  MODIFY `directiveVersion` VARCHAR(64) NOT NULL,
  MODIFY `directiveHash` VARCHAR(64) NOT NULL;
