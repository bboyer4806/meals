import { dateIn, startOfDate } from '#lib/dates.ts';
import { parsePeriod, periodStart } from '#lib/reports.ts';
import { requireHousehold } from '#lib/server/auth/guards.ts';
import { getHousehold } from '#lib/server/data/households.ts';
import {
	countDinnerTypes,
	listForgottenFavorites,
	rankPlannedDishes,
	rankPurchasedItems,
	rankRestaurants
} from '#lib/server/data/reports.ts';

// Reports (design 7, Reports; MEA-14). The first four follow the period, in the household's
// dates (design 11), and Forgotten Favorites doesn't. The page only reads.
export function load({ locals, url }) {
	const user = requireHousehold(locals);
	const { timeZone } = getHousehold(user.householdId);
	const today = dateIn(Date.now(), timeZone);
	const period = parsePeriod(url.searchParams.get('period'));
	const start = periodStart(period, today);
	// Grocery lines count by when they were received: from when the first date starts there.
	const since = start === null ? null : startOfDate(start, timeZone);
	return {
		period,
		today,
		dishes: rankPlannedDishes(user.householdId, start, today),
		groceries: rankPurchasedItems(user.householdId, since),
		restaurants: rankRestaurants(user.householdId, start, today),
		dinnerTypes: countDinnerTypes(user.householdId, start, today),
		forgotten: listForgottenFavorites(user.householdId, today)
	};
}
