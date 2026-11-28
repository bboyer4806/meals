import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isHttpError } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { revokeConnection } from '../auth/oauth.ts';
import { loadConfig } from '../config.ts';
import { getDish, setDishPhoto } from '../data/dishes.ts';
import { getHousehold } from '../data/households.ts';
import {
	createItem,
	getItem,
	listCatalog,
	setItemArchived,
	setItemPhoto
} from '../data/items.ts';
import { addNeed, getLine, listActiveLines, updateLine } from '../data/needs.ts';
import { createStore, listStores } from '../data/stores.ts';
import { db } from '../db/index.ts';
import { aiConnections, aiProposals, dishes, groceryNeeds } from '../db/schema.ts';
import { photoPath, savePhoto } from '../photos.ts';
import {
	expectHttpError,
	freshDb,
	ingredient,
	makeDish,
	makeHousehold,
	recipe,
	servePages,
	TEST_ENV
} from '../testing.ts';
import {
	approveProposal,
	discardExpiredImages,
	getProposal,
	listProposals,
	proposalInput,
	proposeChanges,
	PROPOSAL_LIFETIME,
	rejectProposal
} from './proposals.ts';

let connectionId: number;
let one: number;
let two: number;
let dataDir: string;

beforeEach(() => {
	freshDb();
	// Where proposed images are stored, as the server's settings say (hooks.server.ts).
	dataDir = mkdtempSync(join(tmpdir(), 'meals-proposals-'));
	loadConfig({ ...TEST_ENV, DATA_DIR: dataDir });
	const admin = makeHousehold();
	one = admin.householdId;
	two = makeHousehold().householdId;
	connectionId = db()
		.insert(aiConnections)
		.values({
			clientId: 'claude-client',
			platform: 'claude',
			redirectUris: '[]',
			createdAt: 0,
			userId: admin.userId,
			authorizedAt: 0
		})
		.returning({ id: aiConnections.id })
		.get().id;
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	vi.restoreAllMocks();
});

function propose(changes: object[], now = 0) {
	return proposeChanges(connectionId, proposalInput.parse({ summary: 'Weekly shop', changes }), now);
}

/** Why proposing was refused (400). */
async function refusal(proposing: Promise<unknown>): Promise<string> {
	const thrown = await proposing.then(
		() => null,
		(e: unknown) => e
	);
	if (!isHttpError(thrown, 400)) throw new Error(`expected HTTP 400, got ${String(thrown)}`);
	return thrown.body.message;
}

const addMilk = (householdId: number) => ({
	operation: 'add_grocery_line',
	householdId,
	itemName: 'Milk',
	quantity: 1,
	unit: null,
	store: 'none'
});

const rename = (householdId: number, name: string) => ({
	operation: 'update_household',
	householdId,
	name,
	defaultServings: 4,
	timeZone: 'America/Chicago'
});

function lines(householdId: number) {
	return listActiveLines(householdId, 'America/Chicago', 0);
}

describe('proposing', () => {
	it('saves what each change shows, for any households, and changes nothing yet', async () => {
		const nameOfTwo = getHousehold(two).name;
		const proposal = await propose([addMilk(one), rename(two, 'The Smiths')], 1000);
		expect(proposal).toMatchObject({
			connectionId,
			platform: 'claude',
			summary: 'Weekly shop',
			status: 'pending',
			error: null,
			createdAt: 1000,
			expiresAt: 1000 + PROPOSAL_LIFETIME,
			decidedAt: null,
			hash: expect.stringMatching(/^[0-9a-f]{64}$/)
		});
		expect(proposal.changes).toMatchObject([
			{ title: 'Add to the grocery list', householdId: one, record: null, current: [] },
			{ title: "Change the household's settings", householdId: two, record: `Household ${two}` }
		]);
		expect(lines(one)).toEqual([]);
		expect(getHousehold(two).name).toBe(nameOfTwo);
	});

	it('refuses changes that can’t be made, saying which and why, and saves nothing', async () => {
		// The second Milk is the duplicate the add bar would warn about.
		expect(await refusal(propose([addMilk(one), addMilk(one)]))).toBe(
			'Change 2 (add_grocery_line): Milk is already on the grocery list (1, To order).'
		);
		expect(lines(one)).toEqual([]);
		expect(db().select().from(aiProposals).all()).toEqual([]);
	});

	it('takes a summary and up to 50 changes', () => {
		const parse = (input: object) =>
			proposalInput.safeParse(input).error?.issues.map((issue) => issue.message);
		expect(parse({ summary: ' ', changes: [addMilk(one)] })).toEqual(['Say what the changes are for']);
		expect(parse({ summary: 'x', changes: [] })).toEqual(['Propose at least one change']);
		const many = Array.from({ length: 51 }, () => addMilk(one));
		expect(parse({ summary: 'x', changes: many })).toEqual(['Propose up to 50 changes at a time']);
		// Nothing but the listed operations, so no SQL and no change to the database's tables.
		const sql = { operation: 'run_sql', sql: 'drop table users' };
		expect(parse({ summary: 'x', changes: [sql] })).toEqual([
			expect.stringContaining("Invalid discriminator value. Expected 'update_household' |")
		]);
	});
});

describe('approving (design 6.17)', () => {
	it('makes every change, in every household, once', async () => {
		const proposal = await propose([addMilk(one), rename(two, 'The Smiths')]);
		expect(approveProposal(proposal.id, proposal.hash, 2000)).toEqual({
			kind: 'approved',
			householdIds: [one, two]
		});
		expect(lines(one).map((line) => line.itemName)).toEqual(['Milk']);
		expect(getHousehold(two).name).toBe('The Smiths');
		expect(getProposal(proposal.id, 2000)).toMatchObject({ status: 'approved', decidedAt: 2000 });

		// Approving again changes nothing.
		expectHttpError(() => approveProposal(proposal.id, proposal.hash, 3000), 400);
		expect(lines(one)).toHaveLength(1);
	});

	it('makes none of the changes when one fails, and fails the proposal for good', async () => {
		const nameOfOne = getHousehold(one).name;
		const proposal = await propose([
			rename(one, 'Renamed'),
			addMilk(two),
			{ operation: 'create_store', householdId: two, name: 'Costco' }
		]);
		// Someone adds the store in Meals before the admin approves.
		createStore(two, 'Costco');

		expect(approveProposal(proposal.id, proposal.hash, 2000)).toEqual({
			kind: 'failed',
			error: 'Change 3 (create_store): A store is already called Costco.'
		});
		expect(getHousehold(one).name).toBe(nameOfOne);
		expect(lines(two)).toEqual([]);
		expect(listStores(two)).toHaveLength(1);
		expect(getProposal(proposal.id, 2000)).toMatchObject({
			status: 'failed',
			error: 'Change 3 (create_store): A store is already called Costco.',
			decidedAt: 2000
		});
		expectHttpError(() => approveProposal(proposal.id, proposal.hash, 3000), 400);
		expectHttpError(() => rejectProposal(proposal.id, proposal.hash, 3000), 400);
	});

	it('fails when a record it changes was changed after it was proposed', async () => {
		addNeed(one, { itemName: 'Eggs', quantity: 1, unit: null, store: 'none', resolution: 'none' }, 0);
		const [line] = lines(one);
		const proposal = await propose([
			{
				operation: 'update_grocery_line',
				householdId: one,
				lineId: line!.id,
				quantity: 2,
				unit: null,
				storeId: null,
				note: null
			}
		]);
		updateLine(one, line!.id, { quantity: 12, unit: null, storeId: null, note: null });
		const approval = approveProposal(proposal.id, proposal.hash, 2000);
		expect(approval).toEqual({
			kind: 'failed',
			error: `Change 1 (update_grocery_line): Grocery line ${line!.id} changed after this was proposed.`
		});
		expect(getLine(one, line!.id).quantity).toBe(12);
	});

	it('refuses another version of the proposal, an expired one or a rejected one', async () => {
		const proposal = await propose([addMilk(one)], 0);
		expectHttpError(() => approveProposal(proposal.id, 'f'.repeat(64), 1000), 400);

		// Its content is never changed, so a changed one isn't the one the page showed.
		const forged = JSON.stringify({ summary: 'Weekly shop', changes: [] });
		const content = db().select({ content: aiProposals.content }).from(aiProposals).get()!.content;
		db().update(aiProposals).set({ content: forged }).where(eq(aiProposals.id, proposal.id)).run();
		expectHttpError(() => approveProposal(proposal.id, proposal.hash, 1000), 400);
		db().update(aiProposals).set({ content }).where(eq(aiProposals.id, proposal.id)).run();

		expect(getProposal(proposal.id, PROPOSAL_LIFETIME).status).toBe('expired');
		expectHttpError(() => approveProposal(proposal.id, proposal.hash, PROPOSAL_LIFETIME), 400);

		rejectProposal(proposal.id, proposal.hash, 1000);
		expect(getProposal(proposal.id, 1000)).toMatchObject({ status: 'rejected', decidedAt: 1000 });
		expectHttpError(() => approveProposal(proposal.id, proposal.hash, 2000), 400);
		expect(lines(one)).toEqual([]);
		expectHttpError(() => approveProposal(proposal.id + 1, proposal.hash, 2000), 404);
	});

	it('goes with its connection when that is revoked', async () => {
		const proposal = await propose([addMilk(one)]);
		revokeConnection(connectionId);
		expectHttpError(() => getProposal(proposal.id, 0), 404);
		expectHttpError(() => approveProposal(proposal.id, proposal.hash, 0), 404);
	});
});

it('lists the newest proposals first', async () => {
	const first = await propose([addMilk(one)], 0);
	const second = await propose([rename(one, 'Home'), rename(two, 'Away')], 10);
	rejectProposal(first.id, first.hash, 20);
	expect(listProposals(30, 10)).toEqual([
		{ id: second.id, platform: 'claude', summary: 'Weekly shop', changeCount: 2, status: 'pending', createdAt: 10 },
		{ id: first.id, platform: 'claude', summary: 'Weekly shop', changeCount: 1, status: 'rejected', createdAt: 0 }
	]);
});

describe('images (MEA-276)', () => {
	const PIE = 'https://recipes.example/pie.png';
	const MILK = 'https://shop.example/milk.jpg';

	/** A picture of one color, which the links in `pages` answer with. */
	function picture(color: string, format: 'png' | 'jpeg' = 'png'): Promise<Buffer> {
		return sharp({ create: { width: 900, height: 600, channels: 3, background: color } })
			.toFormat(format)
			.toBuffer();
	}

	async function serveImages(links: string[]) {
		const pages = Object.fromEntries(
			await Promise.all(links.map(async (link) => [link, { status: 200, body: await picture('#c84') }]))
		);
		return servePages(pages);
	}

	function storedKeys(): string[] {
		const dir = join(dataDir, 'photos');
		const files = existsSync(dir) ? readdirSync(dir) : [];
		return [...new Set(files.map((file) => file.slice(0, 32)))].sort();
	}

	/** An image already stored, as one picked in Meals is. */
	async function existingImage(): Promise<string> {
		const bytes = await picture('#365', 'jpeg');
		return savePhoto(new File([new Uint8Array(bytes)], 'photo.jpg'), new File([new Uint8Array(bytes)], 'thumb.jpg'));
	}

	const recipeImage = (householdId: number, recipeId: number, imageUrl = PIE, replace = false) => ({
		operation: 'set_recipe_image',
		householdId,
		recipeId,
		imageUrl,
		replace
	});

	const itemImage = (householdId: number, itemId: number, imageUrl = MILK, replace = false) => ({
		operation: 'set_item_image',
		householdId,
		itemId,
		imageUrl,
		replace
	});

	/** The keys of the images a proposal proposes, in the order of its changes. */
	function proposedKeys(proposal: { changes: { proposed: { photoKey?: string }[] }[] }): string[] {
		return proposal.changes.flatMap((change) =>
			change.proposed.flatMap(({ photoKey }) => (photoKey === undefined ? [] : [photoKey]))
		);
	}

	it('stores each image when proposed, and gives it to its record only when approved', async () => {
		await serveImages([PIE, MILK]);
		const pie = makeDish(one, recipe('Apple pie', { steps: 'Bake', ingredients: [ingredient('Apples', 6)] }));
		const milk = createItem(two, 'Milk', 0).id;
		const oldMilk = await existingImage();
		setItemPhoto(two, milk, oldMilk);
		const pieBefore = getDish(one, pie);
		const milkBefore = getItem(two, milk);

		const proposal = await propose([recipeImage(one, pie), itemImage(two, milk, MILK, true)]);
		const [pieImage, milkImage] = proposedKeys(proposal);
		expect(proposal.changes).toEqual([
			{
				title: 'Add an image to a recipe',
				householdId: one,
				householdName: getHousehold(one).name,
				record: `Recipe ${pie}`,
				current: [
					{ name: 'Name', value: 'Apple pie' },
					{ name: 'Image', value: 'None' }
				],
				proposed: [{ name: 'Image', value: PIE, photoKey: pieImage }]
			},
			{
				title: "Replace an item's image",
				householdId: two,
				householdName: getHousehold(two).name,
				record: `Item ${milk}`,
				current: [
					{ name: 'Name', value: 'Milk' },
					{ name: 'Image', value: 'An image', photoKey: oldMilk }
				],
				proposed: [{ name: 'Image', value: MILK, photoKey: milkImage }]
			}
		]);
		// Stored as Meals stores any photo, ready for the page to show.
		expect(storedKeys()).toEqual([pieImage, milkImage, oldMilk].sort());
		expect(getDish(one, pie).photoKey).toBeNull();
		expect(getItem(two, milk).photoKey).toBe(oldMilk);

		expect(approveProposal(proposal.id, proposal.hash, 2000)).toEqual({
			kind: 'approved',
			householdIds: [one, two]
		});
		// Only the image changes: the recipe's details and the item's name and notes stay.
		expect(getDish(one, pie)).toEqual({ ...pieBefore, photoKey: pieImage });
		expect(getItem(two, milk)).toEqual({ ...milkBefore, photoKey: milkImage });
		// The image it replaced goes; the approved ones stay.
		expect(storedKeys()).toEqual([pieImage, milkImage].sort());
	});

	it('gives the record the image the admin saw, without fetching its link again', async () => {
		const requested = await serveImages([PIE]);
		const pie = makeDish(one, recipe('Apple pie'));
		const proposal = await propose([recipeImage(one, pie)]);
		const [shown] = proposedKeys(proposal);
		const bytes = readFileSync(photoPath(shown!, 'full'));

		// The link answers with another picture now.
		servePages({ [PIE]: { status: 200, body: await picture('#123') } });
		approveProposal(proposal.id, proposal.hash, 2000);
		expect(getDish(one, pie).photoKey).toBe(shown);
		expect(readFileSync(photoPath(shown!, 'full'))).toEqual(bytes);
		expect(requested).toEqual([PIE]);
	});

	it('replaces an image only when the change says to, keeping it and storing nothing', async () => {
		await serveImages([MILK]);
		const milk = createItem(one, 'Milk', 0).id;
		const oldMilk = await existingImage();
		setItemPhoto(one, milk, oldMilk);
		expect(await refusal(propose([itemImage(one, milk)]))).toBe(
			`Change 1 (set_item_image): Item ${milk} already has an image. Send replace: true to replace it.`
		);
		expect(getItem(one, milk).photoKey).toBe(oldMilk);
		expect(storedKeys()).toEqual([oldMilk]);
		expect(db().select().from(aiProposals).all()).toEqual([]);
	});

	it("refuses a link that doesn't lead to an image, saying which change, and keeps nothing", async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		await serveImages([PIE]);
		const pie = makeDish(one, recipe('Apple pie'));
		const milk = createItem(one, 'Milk', 0).id;
		for (const link of ['https://shop.example/milk', 'https://10.0.0.5/milk.jpg']) {
			expect(await refusal(propose([addMilk(one), recipeImage(one, pie), itemImage(one, milk, link)]))).toBe(
				"Change 3 (set_item_image): Couldn't get an image from that link. Use the image's own link, not the page it's on."
			);
		}
		expect(storedKeys()).toEqual([]);
		expect(lines(one)).toEqual([]);
		expect(getDish(one, pie).photoKey).toBeNull();
		expect(db().select().from(aiProposals).all()).toEqual([]);
	});

	it('deletes the images it stored when another change is refused', async () => {
		await serveImages([PIE]);
		const pie = makeDish(one, recipe('Apple pie'));
		expect(await refusal(propose([recipeImage(one, pie), addMilk(one), addMilk(one)]))).toBe(
			'Change 3 (add_grocery_line): Milk is already on the grocery list (1, To order).'
		);
		expect(await refusal(propose([recipeImage(one, pie + 1)]))).toBe(
			`Change 1 (set_recipe_image): Recipe ${pie + 1} wasn't found`
		);
		expect(storedKeys()).toEqual([]);
	});

	it('takes only https links, and up to 10 images at a time', () => {
		const parse = (changes: object[]) =>
			proposalInput.safeParse({ summary: 'Photos', changes }).error?.issues.map((issue) => issue.message);
		expect(parse([recipeImage(one, 1, 'http://recipes.example/pie.png')])).toEqual([
			'Send a link that starts with https://'
		]);
		expect(parse([recipeImage(one, 1, `https://recipes.example/${'a'.repeat(2000)}.png`)])).toEqual([
			'Keep the link under 2000 characters'
		]);
		const images = (count: number) => Array.from({ length: count }, (_, index) => recipeImage(one, index + 1));
		expect(parse(images(10))).toBeUndefined();
		expect(parse(images(11))).toEqual(['Propose up to 10 images at a time']);
	});

	it('needs replace for a second image for a record in the same proposal', async () => {
		const second = 'https://recipes.example/pie-2.png';
		await serveImages([PIE, second]);
		const pie = makeDish(one, recipe('Apple pie'));
		expect(await refusal(propose([recipeImage(one, pie), recipeImage(one, pie, second)]))).toBe(
			`Change 2 (set_recipe_image): Recipe ${pie} already has an image. Send replace: true to replace it.`
		);
		expect(storedKeys()).toEqual([]);

		const proposal = await propose([recipeImage(one, pie), recipeImage(one, pie, second, true)]);
		const [, last] = proposedKeys(proposal);
		approveProposal(proposal.id, proposal.hash, 2000);
		expect(getDish(one, pie).photoKey).toBe(last);
		expect(storedKeys()).toEqual([last]);
	});

	it('deletes the proposed images when rejected, keeping the current ones', async () => {
		await serveImages([MILK]);
		const milk = createItem(one, 'Milk', 0).id;
		const oldMilk = await existingImage();
		setItemPhoto(one, milk, oldMilk);
		const proposal = await propose([itemImage(one, milk, MILK, true)]);
		expect(storedKeys()).toHaveLength(2);

		rejectProposal(proposal.id, proposal.hash, 2000);
		expect(getItem(one, milk).photoKey).toBe(oldMilk);
		expect(storedKeys()).toEqual([oldMilk]);
	});

	it('changes no record when approving fails, keeping the current images', async () => {
		await serveImages([PIE, MILK]);
		const pie = makeDish(one, recipe('Apple pie'));
		const oldPie = await existingImage();
		setDishPhoto(one, pie, oldPie);
		const milk = createItem(two, 'Milk', 0).id;
		const proposal = await propose([
			recipeImage(one, pie, PIE, true),
			itemImage(two, milk),
			{ operation: 'create_store', householdId: two, name: 'Costco' }
		]);
		createStore(two, 'Costco');

		expect(approveProposal(proposal.id, proposal.hash, 2000)).toEqual({
			kind: 'failed',
			error: 'Change 3 (create_store): A store is already called Costco.'
		});
		expect(getDish(one, pie).photoKey).toBe(oldPie);
		expect(getItem(two, milk).photoKey).toBeNull();
		expect(storedKeys()).toEqual([oldPie]);
	});

	it('fails when the image was changed in Meals after it was proposed', async () => {
		await serveImages([MILK]);
		const milk = createItem(one, 'Milk', 0).id;
		const proposal = await propose([itemImage(one, milk)]);
		// Someone gives the item an image on Items meanwhile.
		const picked = await existingImage();
		setItemPhoto(one, milk, picked);

		expect(approveProposal(proposal.id, proposal.hash, 2000)).toEqual({
			kind: 'failed',
			error: `Change 1 (set_item_image): Item ${milk} changed after this was proposed.`
		});
		expect(getItem(one, milk).photoKey).toBe(picked);
		expect(storedKeys()).toEqual([picked]);
	});

	it('deletes the images of a proposal a minute after it expires, keeping the current ones', async () => {
		await serveImages([MILK]);
		const milk = createItem(one, 'Milk', 0).id;
		const oldMilk = await existingImage();
		setItemPhoto(one, milk, oldMilk);
		const proposal = await propose([itemImage(one, milk, MILK, true)], 0);
		const [proposed] = proposedKeys(proposal);

		discardExpiredImages(PROPOSAL_LIFETIME + 59_999);
		expect(storedKeys()).toEqual([oldMilk, proposed].sort());
		discardExpiredImages(PROPOSAL_LIFETIME + 60_000);
		expect(storedKeys()).toEqual([oldMilk]);
		expect(getItem(one, milk).photoKey).toBe(oldMilk);

		// The next proposal does the same, as the app does when it starts.
		const later = await propose([itemImage(one, milk, MILK, true)], 0);
		await propose([addMilk(two)], PROPOSAL_LIFETIME + 60_000);
		expect(storedKeys()).toEqual([oldMilk]);
		expect(getProposal(later.id, PROPOSAL_LIFETIME + 60_000).status).toBe('expired');
	});

	it("deletes its proposals' images when the connection is revoked, but the approved ones", async () => {
		const second = 'https://recipes.example/pie-2.png';
		await serveImages([PIE, second]);
		const pie = makeDish(one, recipe('Apple pie'));
		const tart = makeDish(one, recipe('Tart'));
		const approved = await propose([recipeImage(one, pie)]);
		approveProposal(approved.id, approved.hash, 1000);
		await propose([recipeImage(one, tart, second)]);
		expect(storedKeys()).toHaveLength(2);

		revokeConnection(connectionId);
		expect(storedKeys()).toEqual(proposedKeys(approved));
		expect(getDish(one, pie).photoKey).toBe(proposedKeys(approved)[0]);
	});

	describe('of new items (MEA-279)', () => {
		// By name, as the catalog sorts them.
		const FRUITS = ['Dragon fruit', 'Kumquats', 'Lychees', 'Passion fruit', 'Starfruit'];
		const link = (name: string) => `https://shop.example/${name.toLowerCase().replaceAll(' ', '-')}.png`;

		const newItem = (
			householdId: number,
			name: string,
			imageUrl: string | null = link(name),
			notes: string | null = null
		) => ({ operation: 'create_item', householdId, name, notes, imageUrl });

		/** The household's active items with these names, as list_items lists them. */
		function catalog(householdId: number, names: string[]) {
			return listCatalog(householdId, false, '').filter((item) => names.includes(item.name));
		}

		it('stores each image when proposed, and adds the items with them only when approved', async () => {
			await serveImages(FRUITS.map(link));
			const proposal = await propose(FRUITS.map((name) => newItem(one, name, link(name), `${name}, ripe`)));
			const keys = proposedKeys(proposal);
			expect(keys).toHaveLength(5);
			expect(proposal.changes[0]).toEqual({
				title: 'Add an item',
				householdId: one,
				householdName: getHousehold(one).name,
				record: null,
				current: [],
				proposed: [
					{ name: 'Name', value: 'Dragon fruit' },
					{ name: 'Notes', value: 'Dragon fruit, ripe' },
					{ name: 'Image', value: link('Dragon fruit'), photoKey: keys[0] }
				]
			});
			expect(storedKeys()).toEqual(keys.toSorted());
			expect(catalog(one, FRUITS)).toEqual([]);

			expect(approveProposal(proposal.id, proposal.hash, 2000)).toEqual({
				kind: 'approved',
				householdIds: [one]
			});
			expect(catalog(one, FRUITS).map(({ name, notes, photoKey }) => ({ name, notes, photoKey }))).toEqual(
				FRUITS.map((name, index) => ({ name, notes: `${name}, ripe`, photoKey: keys[index] }))
			);
			// The images the admin saw, kept; and nothing but the catalog changes.
			expect(storedKeys()).toEqual(keys.toSorted());
			expect(db().select().from(groceryNeeds).all()).toEqual([]);
			expect(db().select().from(dishes).all()).toEqual([]);
		});

		it('adds an item without an image, storing none', async () => {
			const proposal = await propose([newItem(one, 'Kumquats', null, 'Organic')]);
			expect(proposal.changes[0]!.proposed).toEqual([
				{ name: 'Name', value: 'Kumquats' },
				{ name: 'Notes', value: 'Organic' },
				{ name: 'Image', value: 'None' }
			]);
			approveProposal(proposal.id, proposal.hash, 2000);
			expect(catalog(one, ['Kumquats'])).toMatchObject([{ notes: 'Organic', photoKey: null }]);
			expect(storedKeys()).toEqual([]);
		});

		it('refuses a name an item has, archived ones included, or an earlier change gives one', async () => {
			await serveImages(FRUITS.map(link));
			setItemArchived(one, createItem(one, 'Kumquats', 0).id, true, 0);
			expect(await refusal(propose([newItem(one, 'Lychees'), newItem(one, 'kumquats')]))).toBe(
				'Change 2 (create_item): An archived item is already called kumquats. Restore it instead.'
			);
			const twice = [newItem(one, 'Lychees'), newItem(one, 'Starfruit'), newItem(one, 'LYCHEES', null)];
			expect(await refusal(propose(twice))).toBe('Change 3 (create_item): An item is already called LYCHEES.');
			// Adding Milk to the list adds the item first.
			expect(await refusal(propose([addMilk(one), newItem(one, 'Milk', null)]))).toBe(
				'Change 2 (create_item): An item is already called Milk.'
			);
			expect(catalog(one, ['Lychees', 'Starfruit', 'Milk'])).toEqual([]);
			expect(storedKeys()).toEqual([]);
			expect(db().select().from(aiProposals).all()).toEqual([]);
		});

		it('fails when an item got the name after it was proposed, adding none of the items', async () => {
			await serveImages(FRUITS.map(link));
			const proposal = await propose([newItem(one, 'Lychees'), newItem(two, 'Starfruit')]);
			// Someone adds the item in Meals before the admin approves.
			createItem(two, 'starfruit', 0);

			expect(approveProposal(proposal.id, proposal.hash, 2000)).toEqual({
				kind: 'failed',
				error: 'Change 2 (create_item): An item is already called Starfruit.'
			});
			expect(catalog(one, ['Lychees'])).toEqual([]);
			expect(catalog(two, ['starfruit'])).toMatchObject([{ photoKey: null }]);
			expect(storedKeys()).toEqual([]);
		});

		it('adds none of the items when another change fails, and deletes their images', async () => {
			await serveImages(FRUITS.map(link));
			const proposal = await propose([
				newItem(one, 'Lychees'),
				newItem(one, 'Kumquats', null),
				{ operation: 'create_store', householdId: two, name: 'Costco' }
			]);
			createStore(two, 'Costco');

			expect(approveProposal(proposal.id, proposal.hash, 2000)).toEqual({
				kind: 'failed',
				error: 'Change 3 (create_store): A store is already called Costco.'
			});
			expect(catalog(one, ['Lychees', 'Kumquats'])).toEqual([]);
			expect(storedKeys()).toEqual([]);
		});

		it("refuses a link that doesn't lead to an image, saying which change, and keeps nothing", async () => {
			vi.spyOn(console, 'error').mockImplementation(() => {});
			await serveImages([link('Lychees')]);
			const notAnImage = newItem(one, 'Kumquats', 'https://shop.example/kumquats');
			expect(await refusal(propose([newItem(one, 'Lychees'), notAnImage]))).toBe(
				"Change 2 (create_item): Couldn't get an image from that link. Use the image's own link, not the page it's on."
			);
			expect(catalog(one, ['Lychees', 'Kumquats'])).toEqual([]);
			expect(storedKeys()).toEqual([]);
			expect(db().select().from(aiProposals).all()).toEqual([]);
		});

		it('adds nothing when rejected or expired, and deletes the images', async () => {
			await serveImages([link('Lychees'), link('Starfruit')]);
			const rejected = await propose([newItem(one, 'Lychees')], 0);
			rejectProposal(rejected.id, rejected.hash, 1000);
			const expired = await propose([newItem(one, 'Starfruit')], 0);
			expectHttpError(() => approveProposal(expired.id, expired.hash, PROPOSAL_LIFETIME), 400);
			discardExpiredImages(PROPOSAL_LIFETIME + 60_000);

			expect(catalog(one, ['Lychees', 'Starfruit'])).toEqual([]);
			expect(storedKeys()).toEqual([]);
		});

		it('counts their images toward the 10, but not new items without one', () => {
			const parse = (changes: object[]) =>
				proposalInput.safeParse({ summary: 'Fruit', changes }).error?.issues.map((issue) => issue.message);
			const items = (prefix: string, count: number, imageUrl: string | null) =>
				Array.from({ length: count }, (_, index) => newItem(one, `${prefix} ${index}`, imageUrl));
			expect(parse([...items('Fruit', 9, PIE), recipeImage(one, 1)])).toBeUndefined();
			expect(parse([...items('Fruit', 10, PIE), recipeImage(one, 1)])).toEqual([
				'Propose up to 10 images at a time'
			]);
			expect(parse([...items('Fruit', 10, PIE), ...items('Nut', 5, null)])).toBeUndefined();
		});
	});
});
