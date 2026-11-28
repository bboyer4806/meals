// The grocery list's shared rules (design 6.2), for the page and the server alike.

/** Why a line can't be checked off or get Got fewer: it's already received. */
export const ALREADY_RECEIVED = 'This line was already received';

/**
 * The cookie that keeps which of the list's groups are collapsed on this device, their keys joined
 * with dots, so the server renders them closed (design 7, Grocery list; MEA-134).
 */
export const COLLAPSED_COOKIE = 'collapsed_groups';
