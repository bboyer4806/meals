// The dishes every household's Recipes starts with: common, everyday dishes by name only, so
// people can plan with them before writing any recipe (design 6.18, MEA-258). The groups only
// order the list for review; dishes have no categories, and a dish's role is set per dinner (Q29).
//
// Each revision lists the dishes it added. A household records the last revision it got and gets
// each later one's dishes when the app starts, so revisions are only ever added at the end: a
// change to one already released would never reach the households that got it.

// Revision 1 (MEA-258): the original dishes. Only they have photos packaged with the app; a later
// revision's dishes may have none (design 6.19, MEA-259).
export const ORIGINAL_DEFAULT_DISHES: readonly string[] = [
	// Main dishes (30)
	'Hamburgers', 'Hot Dogs', 'Spaghetti', 'Pizza', 'Tacos', 'Quesadillas', 'Burritos',
	'Lasagna', 'Macaroni and Cheese', 'Grilled Cheese', 'Chicken Nuggets', 'Chicken Tenders',
	'Baked Chicken', 'Grilled Chicken', 'Fried Chicken', 'Chicken Alfredo', 'Chicken Parmesan',
	'Chicken Stir-Fry', 'Beef Stir-Fry', 'Meatloaf', 'Sloppy Joes', 'BBQ Pulled Pork', 'Chili',
	'Chicken Noodle Soup', 'Tomato Soup', 'Beef Stew', 'Pork Chops', 'Baked Salmon',
	'Fish Sticks', 'Turkey Sandwiches',
	// Sides (20)
	'Salad', 'Mixed Fruit', 'French Fries', 'Sweet Potato Fries', 'Mashed Potatoes',
	'Baked Potatoes', 'Roasted Potatoes', 'Rice', 'Fried Rice', 'Steamed Broccoli',
	'Green Beans', 'Corn on the Cob', 'Glazed Carrots', 'Coleslaw', 'Potato Salad',
	'Pasta Salad', 'Garlic Bread', 'Dinner Rolls', 'Baked Beans', 'Applesauce',
	// Desserts (15)
	'Cookies', 'Brownies', 'Chocolate Cake', 'Vanilla Cake', 'Cupcakes', 'Ice Cream',
	'Popsicles', 'Apple Pie', 'Cherry Pie', 'Cheesecake', 'Pudding', 'Rice Krispies Treats',
	'Banana Bread', 'Strawberry Shortcake', 'Fruit Pops',
	// Breakfast (15)
	'Pancakes', 'Waffles', 'Scrambled Eggs', 'Fried Eggs', 'Omelets', 'French Toast',
	'Oatmeal', 'Cereal', 'Toast', 'Bagels', 'Yogurt Parfait', 'Breakfast Burritos',
	'Breakfast Sandwiches', 'Biscuits and Gravy', 'Hash Browns'
];

export const DEFAULT_DISH_REVISIONS: readonly (readonly string[])[] = [ORIGINAL_DEFAULT_DISHES];
