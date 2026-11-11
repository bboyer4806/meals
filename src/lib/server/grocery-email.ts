import { formatQuantity } from '../text.ts';
import { getHousehold } from './data/households.ts';
import { listToOrderLines, type GroceryLine } from './data/needs.ts';
import { listStores } from './data/stores.ts';
import type { Email } from './email.ts';

// The grocery list as an email: what a household has To Order, by store (design 6.16). Nothing
// sends it yet. A later change picks who gets it and when, then sends it with sendEmail.

const NO_ITEMS = 'There are no items to order.';

type StoreGroup = { name: string; lines: GroceryLine[] };

/**
 * The household's grocery list email without a recipient, for
 * sendEmail({ to, ...groceryListEmail(householdId) }). It only reads the list.
 */
export function groceryListEmail(householdId: number): Omit<Email, 'to'> {
	const household = getHousehold(householdId);
	const groups = groupByStore(householdId, listToOrderLines(householdId));
	return {
		subject: `Meals Grocery List: ${household.name}`,
		html: groups.length === 0 ? `<p>${NO_ITEMS}</p>` : groups.map(htmlGroup).join('\n'),
		text: groups.length === 0 ? NO_ITEMS : groups.map(textGroup).join('\n\n')
	};
}

/**
 * Grouped as on the grocery list (design 7): "No store" first, then each store by name, each
 * with its lines by item name.
 */
function groupByStore(householdId: number, lines: GroceryLine[]): StoreGroup[] {
	const sorted = [...lines].sort((a, b) => a.itemName.localeCompare(b.itemName));
	return [
		{ name: 'No store', lines: sorted.filter((line) => line.storeId === null) },
		...listStores(householdId).map((store) => ({
			name: store.name,
			lines: sorted.filter((line) => line.storeId === store.id)
		}))
	].filter((group) => group.lines.length > 0);
}

/**
 * A line's text, which both versions show: the item's name with the quantity and unit as the
 * grocery list shows them (6.5), such as "Milk: 2 gal", then its note when it has one.
 */
function lineText(line: GroceryLine): string[] {
	const quantity = formatQuantity(line.quantity);
	const item = `${line.itemName}: ${line.unit ? `${quantity} ${line.unit}` : quantity}`;
	return line.note ? [item, `Note: ${line.note}`] : [item];
}

function textGroup(group: StoreGroup): string {
	const items = group.lines.map((line) => `- ${lineText(line).join('\n  ')}`);
	return [group.name, ...items].join('\n');
}

function htmlGroup(group: StoreGroup): string {
	const items = group.lines.map((line) => `<li>${lineText(line).map(escapeHtml).join('<br>')}</li>`);
	return [`<h2>${escapeHtml(group.name)}</h2>`, '<ul>', ...items, '</ul>'].join('\n');
}

/** Text that shows as typed in HTML, so a name such as "<b>Tea</b>" can't change the email (6.16). */
function escapeHtml(text: string): string {
	return text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}
