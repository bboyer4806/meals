-- What's new records the newest release someone has seen by its version instead of its date, as
-- releases can share a day (design 7, MEA-25). Each saved date becomes the newest release of that
-- day, so 2026-10-21, the day of 1.3, 1.4 and 1.5, becomes 1.5. Empty stays empty, for someone
-- who has never opened What's new. A date that no release has stops the migration, through this
-- trigger, rather than lose what the person has seen.
CREATE TEMP TRIGGER `whats_new_seen_unknown`
BEFORE UPDATE OF `whats_new_seen` ON `users`
WHEN NEW.`whats_new_seen` IS NULL
BEGIN
	SELECT RAISE(ABORT, 'whats_new_seen has a date that no release has');
END;
--> statement-breakpoint
UPDATE `users`
SET `whats_new_seen` = CASE `whats_new_seen`
	WHEN '2026-10-14' THEN '1.1'
	WHEN '2026-10-20' THEN '1.2'
	WHEN '2026-10-21' THEN '1.5'
	WHEN '2026-10-24' THEN '1.6'
	WHEN '2026-10-26' THEN '1.7'
	WHEN '2026-11-02' THEN '1.8'
END
WHERE `whats_new_seen` IS NOT NULL;
--> statement-breakpoint
DROP TRIGGER `whats_new_seen_unknown`;
