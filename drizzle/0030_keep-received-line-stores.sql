-- Undoing a check-off now puts back the line's store and the item's default store that receiving
-- replaced (design 2.2.3, 6.3, MEA-115). Lines received before have no record of them, so each
-- records its own store for both, and undoing one keeps its store and the default store, as it did.
UPDATE `grocery_needs`
SET `store_before_received` = `store_id`,
	`default_store_before_received` = CASE WHEN `ordered_at` IS NULL THEN `store_id` END
WHERE `status` = 'received';
