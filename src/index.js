/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */



import { DateTime } from 'luxon';

async function validateApiKey(apiKey, env, request) {
	try {
		// Skip validation if running locally
		if (env.ENVIRONMENT === 'development' || env.NODE_ENV === 'development') {
			console.log('Development environment detected, skipping validation');
			return true;
		}

		// Require MASTER_KEY to be set in environment for production
		if (!env.MASTER_KEY) {
			console.error('MASTER_KEY environment variable is not set in production');
			throw new Error('Server configuration error: Authentication is not properly configured');
		}

		// Check for API key in header first, then URL parameter
		if (!apiKey) {
			if (!request) {
				console.error('Request object is undefined in validateApiKey');
				throw new Error('Request object is required for URL parameter validation');
			}
			
			const url = new URL(request.url);
			apiKey = url.searchParams.get('key');
			
			if (!apiKey) {
				throw new Error('No API key provided in header or URL parameters');
			}
		}
		
		// Split the key into its components
		const parts = apiKey.split('_');
		if (parts.length !== 4) {
			throw new Error('Invalid API key format');
		}
		
		const [prefix, random, expiry, providedSignature] = parts;
		
		// Validate prefix
		if (prefix !== 'stucal') {
			throw new Error('Invalid API key prefix');
		}
		
		// Check if key has expired
		const expiryDate = DateTime.fromFormat(expiry, 'yyyy-MM-dd');
		if (!expiryDate.isValid) {
			throw new Error('Invalid expiry date format in API key');
		}
		
		if (expiryDate < DateTime.now()) {
			throw new Error('API key has expired');
		}
		
		// Validate signature
		const keyContent = `${prefix}_${random}_${expiry}`;
		const encoder = new TextEncoder();
		const keyData = encoder.encode(env.MASTER_KEY.slice(0, 3));
		const messageData = encoder.encode(keyContent);
		
		const key = await crypto.subtle.importKey(
			'raw',
			keyData,
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['sign']
		);
		
		const signature = await crypto.subtle.sign(
			'HMAC',
			key,
			messageData
		);
		
		const expectedSignature = Array.from(new Uint8Array(signature))
			.map(b => b.toString(16).padStart(2, '0'))
			.join('')
			.slice(0, 8);
		
		if (expectedSignature !== providedSignature) {
			throw new Error('Invalid API key signature');
		}

		return true;
	} catch (error) {
		console.error('Validation error:', error.message);
		throw error;  // Re-throw with specific message
	}
}

export default {
	async fetch(request, env, ctx) {
		try {
			// Add detailed request logging
			console.log('Request details:', {
				url: request.url,
				method: request.method,
				headers: Object.fromEntries(request.headers),
				env: Object.keys(env)
			});

			const url = new URL(request.url);
			
			// Only check API key if not running locally
			const apiKey = request.headers.get('X-API-Key');
			console.log('API key from header:', apiKey ? 'Present' : 'Missing');
			
			try {
				if (!await validateApiKey(apiKey, env, request)) {
					return new Response(JSON.stringify({ error: 'Invalid or missing API key' }), {
						status: 401,
						headers: { 
							'Content-Type': 'application/json',
							'Access-Control-Allow-Origin': '*',
							'Access-Control-Allow-Headers': 'X-API-Key',
							'Access-Control-Allow-Methods': 'GET, OPTIONS'
						}
					});
				}
			} catch (validationError) {
				const status = validationError.message.includes('No API key provided') ? 401 : 403;
				return new Response(JSON.stringify({ 
					error: validationError.message,
					details: 'Authentication failed'
				}), {
					status,
					headers: { 
						'Content-Type': 'application/json',
						'Access-Control-Allow-Origin': '*'
					}
				});
			}

			// Handle CORS preflight requests
			if (request.method === 'OPTIONS') {
				return new Response(null, {
					headers: {
						'Access-Control-Allow-Origin': '*',
						'Access-Control-Allow-Headers': 'X-API-Key',
						'Access-Control-Allow-Methods': 'GET, OPTIONS'
					}
				});
			}

			const icsUrl = url.searchParams.get('url');
			const days = parseInt(url.searchParams.get('days')) || 7;
			const timezone = url.searchParams.get('timezone') || 'UTC';

			if (!icsUrl) {
				return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
					status: 400,
					headers: { 
						'Content-Type': 'application/json',
						'Access-Control-Allow-Origin': '*'
					}
				});
			}

			const response = await fetch(icsUrl);
			if (!response.ok) {
				throw new Error(`Failed to fetch calendar: ${response.status} ${response.statusText}`);
			}
			const icsText = await response.text();

			const events = parseICS(icsText);
			const groupedEvents = createGroupedEvents(events, days, timezone, icsUrl);

			return new Response(JSON.stringify(groupedEvents), {
				headers: { 
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*'
				},
			});
		} catch (error) {
			console.error('Error in fetch:', {
				error: error.message,
				stack: error.stack,
				url: request?.url,
				method: request?.method,
				headers: request ? Object.fromEntries(request.headers) : 'No request object'
			});
			return new Response(JSON.stringify({ 
				error: error.message,
				details: 'An unexpected error occurred'
			}), {
				status: 500,
				headers: { 
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*'
				}
			});
		}
	},
};

function parseICS(ics) {
	const events = [];
	const lines = ics.split(/\r?\n/);
	let event = null;

	lines.forEach(line => {
		if (line.startsWith('BEGIN:VEVENT')) {
			event = {};
		} else if (line.startsWith('END:VEVENT')) {
			if (event) {
				events.push(formatEvent(event));
			}
			event = null;
		} else if (event) {
			const [key, ...valueParts] = line.split(':');
			if (key && valueParts.length) {
				const value = valueParts.join(':').trim();
				const keyParts = key.split(';');
				const mainKey = keyParts[0].trim();
				
				// Handle all-day events
				if (keyParts.some(part => part.includes('VALUE=DATE'))) {
					event.isAllDay = true;
				}
				
				event[mainKey] = value;
			}
		}
	});

	return events;
}

function formatEvent(event) {
	const start = parseICSDate(event.DTSTART, event.isAllDay);
	const end = parseICSDate(event.DTEND || event.DTSTART, event.isAllDay);
	
	return {
		title: event.SUMMARY || '',
		start: start.toISO(),
		end: end.toISO(),
		description: event.DESCRIPTION || '',
		isAllDay: event.isAllDay || false,
	};
}

function parseICSDate(icsDate, isAllDay = false) {
	if (!icsDate) return DateTime.now();

	// Remove any timezone identifier
	icsDate = icsDate.replace('Z', '');
	
	if (isAllDay) {
		const match = icsDate.match(/^(\d{4})(\d{2})(\d{2})$/);
		if (match) {
			const [_, year, month, day] = match;
			return DateTime.utc(
				parseInt(year),
				parseInt(month),
				parseInt(day)
			);
		}
	}

	const match = icsDate.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?$/);
	if (match) {
		const [, year, month, day, hour = '00', minute = '00', second = '00'] = match;
		return DateTime.utc(
			parseInt(year),
			parseInt(month),
			parseInt(day),
			parseInt(hour),
			parseInt(minute),
			parseInt(second)
		);
	}

	return DateTime.now();
}

function convertToTimezone(isoDate, timezone) {
	return DateTime.fromISO(isoDate)
		.setZone(timezone)
		.toISO();
}

function createGroupedEvents(events, days, timezone, requestUrl) {
	const now = DateTime.now().setZone(timezone).startOf('day');
	const endDate = now.plus({ days });

	// Group events by date
	const groupedByDate = {};

	events.forEach(event => {
		const start = DateTime.fromISO(event.start).setZone(timezone);
		const end = DateTime.fromISO(event.end).setZone(timezone);

		// Skip events that end before now
		if (end < now) return;

		// Skip events that start after endDate
		if (start > endDate) return;

		// Check if event crosses midnight in the target timezone
		const startDay = start.toISODate();
		const endDay = end.toISODate();
		const crossDay = startDay !== endDay;

		const dateKey = startDay;
		
		if (!groupedByDate[dateKey]) {
			groupedByDate[dateKey] = [];
		}

		// Add event to its start date with original times
		groupedByDate[dateKey].push({
			title: event.title,
			start: start.toISO(),
			end: crossDay ? start.endOf('day').toISO() : end.toISO(),
			description: event.description,
			isFullDay: event.isAllDay,
			crossDay,
			timezone
		});

		// If event crosses days, add it to subsequent days
		if (crossDay) {
			let currentDate = start.plus({ days: 1 }).startOf('day');

			while (currentDate <= end && currentDate < endDate) {
				const nextDateKey = currentDate.toISODate();
				
				if (!groupedByDate[nextDateKey]) {
					groupedByDate[nextDateKey] = [];
				}

				groupedByDate[nextDateKey].push({
					title: event.title,
					start: currentDate.toISO(),
					end: currentDate.toISODate() === endDay 
						? end.toISO()
						: currentDate.endOf('day').toISO(),
					description: event.description,
					isFullDay: event.isAllDay,
					crossDay,
					timezone
				});

				currentDate = currentDate.plus({ days: 1 });
			}
		}
	});

	// Sort events within each day
	Object.keys(groupedByDate).forEach(date => {
		groupedByDate[date].sort((a, b) => {
			if (a.isFullDay && !b.isFullDay) return -1;
			if (!a.isFullDay && b.isFullDay) return 1;
			return DateTime.fromISO(a.start) < DateTime.fromISO(b.start) ? -1 : 1;
		});
	});

	// Create final sorted agenda
	const agenda = Object.entries(groupedByDate)
		.sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
		.map(([date, events]) => ({
			date,
			events
		}));

	// Extract domain from URL for safe display
	const getCalendarDomain = (url) => {
		try {
			const urlObj = new URL(url);
			return urlObj.hostname;
		} catch (e) {
			return 'unknown';
		}
	};

	return {
		agenda,
		timezone,
		request: {
			calendar: getCalendarDomain(requestUrl),
			days,
			requestedTimezone: timezone
		}
	};
}
