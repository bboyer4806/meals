// The standard items every household's catalog starts with: common groceries and household goods,
// so people can pick them instead of typing each one (design 6.13, MEA-61). The groups only order
// the list for review; the app has no categories (Q23). Each household gets the list once, so a
// change here reaches only households set up after it.

export const STANDARD_ITEMS: readonly string[] = [
	// Fresh Fruit (16)
	'Apples', 'Bananas', 'Oranges', 'Mandarins', 'Lemons', 'Limes', 'Grapes', 'Strawberries',
	'Blueberries', 'Raspberries', 'Blackberries', 'Pineapple', 'Watermelon', 'Cantaloupe',
	'Peaches', 'Pears',
	// Vegetables & Herbs (28)
	'Potatoes', 'Sweet Potatoes', 'Yellow Onions', 'Red Onions', 'Green Onions', 'Garlic',
	'Tomatoes', 'Cherry Tomatoes', 'Romaine Lettuce', 'Iceberg Lettuce', 'Spinach', 'Kale',
	'Broccoli', 'Cauliflower', 'Carrots', 'Celery', 'Cucumbers', 'Bell Peppers', 'Jalapeños',
	'Mushrooms', 'Zucchini', 'Asparagus', 'Green Beans', 'Corn', 'Cabbage', 'Avocados',
	'Cilantro', 'Parsley',
	// Meat, Poultry & Seafood (20)
	'Chicken Breasts', 'Chicken Thighs', 'Whole Chicken', 'Ground Beef', 'Ground Turkey',
	'Beef Steaks', 'Beef Roast', 'Stew Meat', 'Pork Chops', 'Pork Tenderloin', 'Bacon',
	'Breakfast Sausage', 'Italian Sausage', 'Hot Dogs', 'Ham', 'Deli Turkey', 'Deli Ham',
	'Salmon', 'Tilapia', 'Shrimp',
	// Dairy, Eggs & Refrigerated (19)
	'Milk', 'Chocolate Milk', 'Eggs', 'Butter', 'Unsalted Butter', 'Cheddar Cheese',
	'Mozzarella Cheese', 'Parmesan Cheese', 'American Cheese', 'Shredded Cheese',
	'String Cheese', 'Cream Cheese', 'Sour Cream', 'Cottage Cheese', 'Yogurt', 'Greek Yogurt',
	'Heavy Cream', 'Half-and-Half', 'Whipped Cream',
	// Bread & Bakery (13)
	'White Bread', 'Wheat Bread', 'Hamburger Buns', 'Hot Dog Buns', 'Bagels', 'English Muffins',
	'Tortillas', 'Pita Bread', 'Dinner Rolls', 'Biscuits', 'Croissants', 'Muffins',
	'Garlic Bread',
	// Grains, Pasta & Breakfast (15)
	'White Rice', 'Brown Rice', 'Spaghetti', 'Macaroni', 'Penne Pasta', 'Egg Noodles',
	'Lasagna Noodles', 'Ramen Noodles', 'Quinoa', 'Oatmeal', 'Breakfast Cereal', 'Granola',
	'Pancake Mix', 'Grits', 'Instant Oatmeal',
	// Canned & Jarred Foods (22)
	'Diced Tomatoes', 'Crushed Tomatoes', 'Tomato Sauce', 'Tomato Paste', 'Pasta Sauce',
	'Chicken Broth', 'Beef Broth', 'Vegetable Broth', 'Black Beans', 'Kidney Beans',
	'Pinto Beans', 'Chickpeas', 'Refried Beans', 'Canned Corn', 'Canned Green Beans',
	'Canned Peas', 'Canned Tuna', 'Canned Chicken', 'Canned Soup', 'Applesauce',
	'Canned Pineapple', 'Canned Peaches',
	// Baking, Oils & Spices (26)
	'All-Purpose Flour', 'Granulated Sugar', 'Brown Sugar', 'Powdered Sugar', 'Baking Powder',
	'Baking Soda', 'Yeast', 'Cornstarch', 'Vanilla Extract', 'Cocoa Powder', 'Chocolate Chips',
	'Cake Mix', 'Brownie Mix', 'Olive Oil', 'Vegetable Oil', 'Cooking Spray', 'Salt',
	'Black Pepper', 'Cinnamon', 'Garlic Powder', 'Onion Powder', 'Chili Powder', 'Paprika',
	'Cumin', 'Italian Seasoning', 'Taco Seasoning',
	// Condiments, Sauces & Spreads (23)
	'Ketchup', 'Yellow Mustard', 'Dijon Mustard', 'Mayonnaise', 'Ranch Dressing',
	'Italian Dressing', 'Caesar Dressing', 'BBQ Sauce', 'Hot Sauce', 'Buffalo Sauce',
	'Soy Sauce', 'Teriyaki Sauce', 'Worcestershire Sauce', 'Salsa', 'Peanut Butter',
	'Strawberry Jam', 'Grape Jelly', 'Honey', 'Maple Syrup', 'Pickles', 'Relish', 'Vinegar',
	'Apple Cider Vinegar',
	// Frozen Foods (18)
	'Frozen Pizza', 'Chicken Nuggets', 'Frozen French Fries', 'Tater Tots', 'Frozen Waffles',
	'Frozen Pancakes', 'Frozen Meatballs', 'Frozen Mixed Vegetables', 'Frozen Broccoli',
	'Frozen Corn', 'Frozen Peas', 'Frozen Green Beans', 'Frozen Spinach', 'Frozen Strawberries',
	'Frozen Blueberries', 'Ice Cream', 'Popsicles', 'Frozen Burritos',
	// Snacks & Sweets (19)
	'Potato Chips', 'Tortilla Chips', 'Pretzels', 'Popcorn', 'Saltine Crackers',
	'Cheese Crackers', 'Graham Crackers', 'Cookies', 'Granola Bars', 'Protein Bars',
	'Trail Mix', 'Peanuts', 'Mixed Nuts', 'Raisins', 'Fruit Snacks', 'Applesauce Pouches',
	'Pudding Cups', 'Rice Cakes', 'Chocolate Candy',
	// Beverages (14)
	'Bottled Water', 'Sparkling Water', 'Orange Juice', 'Apple Juice', 'Grape Juice',
	'Lemonade', 'Soda', 'Coffee', 'Coffee Creamer', 'Tea', 'Hot Chocolate Mix', 'Sports Drinks',
	'Drink Mix', 'Energy Drinks',
	// Household & Cleaning (25)
	'Paper Towels', 'Toilet Paper', 'Tissues', 'Napkins', 'Trash Bags', 'Recycling Bags',
	'Aluminum Foil', 'Plastic Wrap', 'Parchment Paper', 'Food Storage Bags', 'Dish Soap',
	'Dishwasher Detergent', 'Laundry Detergent', 'Fabric Softener', 'Dryer Sheets', 'Bleach',
	'All-Purpose Cleaner', 'Disinfecting Wipes', 'Glass Cleaner', 'Toilet Bowl Cleaner',
	'Bathroom Cleaner', 'Sponges', 'Scrub Brushes', 'Hand Soap', 'Air Freshener',
	// Personal Care & Health (21)
	'Shampoo', 'Conditioner', 'Body Wash', 'Bar Soap', 'Toothpaste', 'Toothbrushes',
	'Dental Floss', 'Mouthwash', 'Deodorant', 'Hand Sanitizer', 'Lotion', 'Sunscreen', 'Razors',
	'Shaving Cream', 'Cotton Swabs', 'Cotton Balls', 'Lip Balm', 'Bandages', 'Pain Reliever',
	'Allergy Medicine', 'Feminine Hygiene Products',
	// Baby & Pet Supplies (9)
	'Diapers', 'Baby Wipes', 'Baby Formula', 'Baby Food', 'Dog Food', 'Cat Food', 'Dog Treats',
	'Cat Treats', 'Cat Litter'
];
