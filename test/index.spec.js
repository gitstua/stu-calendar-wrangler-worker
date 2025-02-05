import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src';
import { DateTime } from 'luxon';

describe('Hello World worker', () => {
	it('responds with Hello World! (unit style)', async () => {
		const request = new Request('http://example.com');
		// Create an empty context to pass to `worker.fetch()`.
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		// Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
		await waitOnExecutionContext(ctx);
		expect(await response.text()).toMatchInlineSnapshot(`"Hello World!"`);
	});

	it('responds with Hello World! (integration style)', async () => {
		const response = await SELF.fetch('http://example.com');
		expect(await response.text()).toMatchInlineSnapshot(`"Hello World!"`);
	});
});

describe('iCal to JSON converter', () => {
	const testIcalUrl = 'https://example.com/calendar.ics';

	it('converts iCal to JSON with default days', async () => {
		const request = new Request(`http://example.com?url=${encodeURIComponent(testIcalUrl)}`);
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		
		const result = await response.json();
		expect(result).toMatchObject({
			'2024-03-20': [
				{
					title: 'All Day Event',
					start: '2024-03-20',
					end: '2024-03-20',
					isAllDay: true,
					description: 'Test all day event'
				},
				{
					title: 'Regular Event',
					start: '2024-03-20T10:00:00Z',
					end: '2024-03-20T11:00:00Z',
					isAllDay: false,
					description: 'Test regular event'
				}
			]
		});
	});

	it('handles multi-day events correctly', async () => {
		const request = new Request(`http://example.com?url=${encodeURIComponent(testIcalUrl)}`);
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		
		const result = await response.json();
		
		// Verify the structure
		expect(result).toHaveProperty('agenda');
		expect(Array.isArray(result.agenda)).toBe(true);
		
		// Find the days in the agenda
		const march20 = result.agenda.find(day => day.date === "2024-03-20");
		const march21 = result.agenda.find(day => day.date === "2024-03-21");
		const march22 = result.agenda.find(day => day.date === "2024-03-22");

		// Check first day (original start time, ends at midnight)
		expect(march20.events[0]).toMatchObject({
			title: "Multi-day Event",
			start: "2024-03-20T09:00:00Z",
			end: "2024-03-20T23:59:59Z",
			crossDay: true
		});

		// Check middle day (starts at midnight, ends at midnight)
		expect(march21.events[0]).toMatchObject({
			title: "Multi-day Event",
			start: "2024-03-21T00:00:00Z",
			end: "2024-03-21T23:59:59Z",
			crossDay: true
		});

		// Check last day (starts at midnight, original end time)
		expect(march22.events[0]).toMatchObject({
			title: "Multi-day Event",
			start: "2024-03-22T00:00:00Z",
			end: "2024-03-22T17:00:00Z",
			crossDay: true
		});
	});

	it('respects the days parameter', async () => {
		const request = new Request(`http://example.com?url=${encodeURIComponent(testIcalUrl)}&days=5`);
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		
		const result = await response.json();
		expect(Object.keys(result).length).toBeLessThanOrEqual(5);
	});

	it('returns error for invalid iCal URL', async () => {
		const request = new Request(`http://example.com?url=invalid-url`);
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		
		expect(response.status).toBe(400);
		const result = await response.json();
		expect(result).toHaveProperty('error');
	});

	it('sorts events correctly within each day', async () => {
		const request = new Request(`http://example.com?url=${encodeURIComponent(testIcalUrl)}`);
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		
		const result = await response.json();
		
		// Check each day's events are sorted correctly
		result.agenda.forEach(day => {
			const events = day.events;
			
			// Check that full-day events come first
			const fullDayEvents = events.filter(e => e.isFullDay);
			const regularEvents = events.filter(e => !e.isFullDay);
			
			if (fullDayEvents.length && regularEvents.length) {
				const lastFullDayIndex = events.findIndex(e => !e.isFullDay) - 1;
				expect(events[lastFullDayIndex].isFullDay).toBe(true);
				expect(events[lastFullDayIndex + 1].isFullDay).toBe(false);
			}
			
			// Check that regular events are sorted by start time
			for (let i = 1; i < regularEvents.length; i++) {
				const prevStart = new Date(regularEvents[i-1].start);
				const currStart = new Date(regularEvents[i].start);
				expect(prevStart <= currStart).toBe(true);
			}
		});
	});

	it('handles timezone conversion correctly', async () => {
		const request = new Request(
			`http://example.com?url=${encodeURIComponent(testIcalUrl)}&timezone=America/New_York`
		);
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		
		const result = await response.json();
		
		expect(result.timezone).toBe('America/New_York');
		
		// Find an event and verify its times are in NY timezone
		const march20 = result.agenda.find(day => day.date.startsWith('2024-03-20'));
		expect(march20).toBeDefined();
		
		// Check that times are correctly converted
		const event = march20.events[0];
		expect(event.timezone).toBe('America/New_York');
		expect(event.start).toMatch(/T\d{2}:00:00/); // Should be in NY time
	});

	it('respects the startFrom parameter', async () => {
		const request = new Request(
			`http://example.com?url=${encodeURIComponent(testIcalUrl)}&startFrom=2024-01-01`
		);
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		
		const result = await response.json();
		
		// Verify startFrom is included in request info
		expect(result.request.startFrom).toBe('2024-01-01T00:00:00.000Z');
		
		// Verify no events before the startFrom date
		result.agenda.forEach(day => {
			const dayDate = DateTime.fromISO(day.date);
			expect(dayDate >= DateTime.fromISO('2024-01-01')).toBe(true);
		});
	});
});
