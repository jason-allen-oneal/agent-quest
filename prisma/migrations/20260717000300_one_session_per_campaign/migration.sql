-- Enforce the event-sourced campaign invariant at the database boundary.
ALTER TABLE `Session` ADD UNIQUE INDEX `Session_campaignId_key`(`campaignId`);
