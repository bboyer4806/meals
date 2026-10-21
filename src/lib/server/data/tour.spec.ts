import { beforeEach, describe, expect, it } from 'vitest';
import { freshDb, makeHousehold } from '../testing.ts';
import { needsTour, recordTourSeen } from './tour.ts';

let userId: number;
let otherUserId: number;

beforeEach(() => {
	freshDb();
	({ userId } = makeHousehold());
	({ userId: otherUserId } = makeHousehold());
});

describe('needsTour', () => {
	it('is true for someone who has never finished or skipped it', () => {
		expect(needsTour(userId)).toBe(true);
	});

	it('is false once recorded as seen, for that person only', () => {
		recordTourSeen(userId, Date.now());
		expect(needsTour(userId)).toBe(false);
		expect(needsTour(otherUserId)).toBe(true);
	});
});
