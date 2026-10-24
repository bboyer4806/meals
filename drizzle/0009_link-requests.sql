-- Links every request that has no recipe to one, before dish_id becomes required (design 6.12).
-- fold() matches names as the app does; lower() folds only A to Z.
--
-- First, a new dish for each name that no dish has, ignoring case: one per name per household,
-- spelled as its oldest request typed it, with the household's usual servings and no recipe.
-- It's dated as that request.
INSERT INTO `dishes` (`household_id`, `name`, `servings`, `created_at`, `updated_at`)
SELECT r.`household_id`, r.`name`, h.`default_servings`, r.`created_at`, r.`created_at`
FROM `dish_requests` r
JOIN `households` h ON h.`id` = r.`household_id`
WHERE r.`dish_id` IS NULL
	AND NOT EXISTS (
		SELECT 1 FROM `dishes` d
		WHERE d.`household_id` = r.`household_id` AND fold(d.`name`) = fold(r.`name`)
	)
	AND NOT EXISTS (
		SELECT 1 FROM `dish_requests` o
		WHERE o.`household_id` = r.`household_id`
			AND o.`dish_id` IS NULL
			AND fold(o.`name`) = fold(r.`name`)
			AND (o.`created_at` < r.`created_at` OR (o.`created_at` = r.`created_at` AND o.`id` < r.`id`))
	)
ORDER BY r.`created_at`, r.`id`;
--> statement-breakpoint
-- Then each links to the dish with its name, an archived one included, which stays archived.
-- Each keeps its name as typed.
UPDATE `dish_requests`
SET `dish_id` = (
	SELECT d.`id` FROM `dishes` d
	WHERE d.`household_id` = `dish_requests`.`household_id`
		AND fold(d.`name`) = fold(`dish_requests`.`name`)
)
WHERE `dish_id` IS NULL;
