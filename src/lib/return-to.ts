import { goto, type AfterNavigate } from '$app/navigation';
import { navigating } from '$app/state';

// Returning from a page without adding a Back step (MEA-156), for the editor's Save and Cancel,
// the cooking view's Back to recipe and Import recipes' Cancel (design 7). When the page they
// return to is the one before in history, they go back to it, as it was left: a recipe at its
// servings, Recipes with its search. Otherwise it takes this page's place, so Back from it
// doesn't open this page again.

// The path of the page before this one in history, or null when it isn't known: this page was
// opened or reloaded, or reached with Back or with Forward more than one step. It's where the
// last navigation came from, so for a page that took another's place, as a search does, it's
// the page replaced; none of those pages return anywhere. The root layout notes it after every
// navigation, so it's known to what a page makes later too. Only the browser sets it.
let pageBefore: string | null = null;

/** Notes the page before the one a navigation reached. The root layout calls it after each. */
export function notePageBefore(navigation: AfterNavigate) {
	// Shallow routing changes the address and stays on the page.
	if (navigation.shallow) return;
	// Back, or Forward more than one step, comes from a page that isn't the one before.
	const fromBefore = navigation.type !== 'popstate' || navigation.delta === 1;
	pageBefore = fromBefore ? (navigation.from?.url.pathname ?? null) : null;
}

/**
 * Leaves this page for `href`: back in history when that's the page before this one, otherwise
 * in this page's place. `refreshAll` reloads everything when it takes this page's place.
 */
export async function returnTo(href: string, options: { refreshAll?: boolean } = {}) {
	const url = new URL(href, location.href);
	if (url.pathname === pageBefore) history.back();
	else await goto(url, { ...options, replace: true });
}

/**
 * Follows a link with returnTo. Before the page's script starts, the link works like any other
 * and adds a Back step. A tap while a navigation is on its way does nothing, since going back
 * again would go past the page.
 */
export function returnOnClick(event: MouseEvent & { currentTarget: HTMLAnchorElement }) {
	event.preventDefault();
	if (navigating.to === null) void returnTo(event.currentTarget.href);
}
