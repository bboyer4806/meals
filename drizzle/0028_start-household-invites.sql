-- Setting up a household now takes an invite to start one, kept until the household is set up, or
-- being the admin (design 6.1, MEA-112). Until now signing in used that invite up, so each account
-- without a household, which only such an invite or being the admin could make, gets it back.
INSERT OR IGNORE INTO `invites` (`email`, `household_id`, `created_at`)
SELECT `email`, NULL, `created_at` FROM `users` WHERE `household_id` IS NULL;
