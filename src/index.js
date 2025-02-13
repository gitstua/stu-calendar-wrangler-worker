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

			let icalUrl = url.searchParams.get('url');
			if (!icalUrl) {
				return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
					status: 400,
					headers: { 
						'Content-Type': 'application/json',
						'Access-Control-Allow-Origin': '*'
					}
				});
			}

			// Convert webcal to https
			if (icalUrl.startsWith('webcal://')) {
				icalUrl = 'https://' + icalUrl.substring(9);
			}

			const days = parseInt(url.searchParams.get('days')) || 7;
			const timezone = url.searchParams.get('timezone') || 'UTC';
			const startFrom = url.searchParams.get('startFrom') || 'now';

			try {
				const response = await fetch(icalUrl);
				
				if (!response.ok) {
					console.error(`HTTP error! status: ${response.status}, statusText: ${response.statusText}`);
					const errorBody = await response.text();
					console.error('Error response body:', errorBody);
					
					return new Response(JSON.stringify({
						error: 'Failed to fetch calendar',
						status: response.status,
						statusText: response.statusText,
						details: errorBody
					}), {
						status: response.status,
						headers: {
							'Content-Type': 'application/json',
							'Access-Control-Allow-Origin': '*'
						}
					});
				}

				const icalData = await response.text();

				const events = parseICS(icalData);
				const groupedEvents = createGroupedEvents(events, days, timezone, icalUrl, startFrom);

				return new Response(JSON.stringify(groupedEvents), {
					headers: { 
						'Content-Type': 'application/json',
						'Access-Control-Allow-Origin': '*'
					},
				});
			} catch (fetchError) {
				console.error('Fetch error details:', {
					message: fetchError.message,
					stack: fetchError.stack,
					url: icalUrl
				});

				return new Response(JSON.stringify({
					error: 'Failed to fetch calendar',
					message: fetchError.message,
					url: icalUrl
				}), {
					status: 500,
					headers: {
						'Content-Type': 'application/json',
						'Access-Control-Allow-Origin': '*'
					}
				});
			}
		} catch (error) {
			console.error('General error:', {
				message: error.message,
				stack: error.stack,
				url: url?.toString()
			});

			return new Response(JSON.stringify({
				error: 'Internal server error',
				message: error.message
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
	let continuationLine = '';

	lines.forEach(line => {
		// Handle line continuations (lines starting with space/tab)
		if (line.startsWith(' ') || line.startsWith('\t')) {
			continuationLine += line.substring(1);
			return;
		}

		// Process previous line if there was a continuation
		if (continuationLine) {
			processEventLine(continuationLine, event);
			continuationLine = '';
		}

		// Process current line
		if (line.startsWith('BEGIN:VEVENT')) {
			event = {};
		} else if (line.startsWith('END:VEVENT')) {
			if (event) {
				events.push(formatEvent(event));
			}
			event = null;
		} else if (event) {
			processEventLine(line, event);
		}
	});

	return events;
}

function processEventLine(line, event) {
	const [key, ...valueParts] = line.split(':');
	if (key && valueParts.length) {
		const value = valueParts.join(':').trim();
		const keyParts = key.split(';');
		const mainKey = keyParts[0].trim();
		
		// Handle parameters in key (e.g. DTSTART;TZID=Australia/Sydney)
		const params = {};
		keyParts.slice(1).forEach(param => {
			const [paramName, paramValue] = param.split('=');
			params[paramName] = paramValue;
		});

		// Handle all-day events
		if (params.VALUE === 'DATE' || mainKey === 'DTSTART' || mainKey === 'DTEND') {
			event.isAllDay = params.VALUE === 'DATE';
		}

		// Store timezone if specified
		if (params.TZID) {
			event[`${mainKey}_TZID`] = params.TZID;
		}
		
		event[mainKey] = value;
	}
}

function formatEvent(event) {
	// Parse start date/time considering timezone
	const start = parseICSDate(
		event.DTSTART,
		event.isAllDay,
		event.DTSTART_TZID
	);
	
	// Parse end date/time considering timezone
	const end = parseICSDate(
		event.DTEND || event.DTSTART,
		event.isAllDay, 
		event.DTEND_TZID || event.DTSTART_TZID
	);

	return {
		title: event.SUMMARY || '',
		start: start.toISO(),
		end: end.toISO(),
		description: event.DESCRIPTION || '',
		location: event.LOCATION || '',
		isAllDay: event.isAllDay || false,
		timezone: event.DTSTART_TZID || 'UTC',
		uid: event.UID || '',
		created: event.CREATED ? parseICSDate(event.CREATED).toISO() : null,
		lastModified: event.LAST_MODIFIED ? parseICSDate(event.LAST_MODIFIED).toISO() : null,
	};
}

function parseICSDate(icsDate, isAllDay = false, timezone = 'UTC') {
	if (!icsDate) return DateTime.now();

	// Remove any timezone identifier
	icsDate = icsDate.replace('Z', '');
	
	if (isAllDay) {
		const match = icsDate.match(/^(\d{4})(\d{2})(\d{2})$/);
		if (match) {
			const [_, year, month, day] = match;
			return DateTime.fromObject(
				{
					year: parseInt(year),
					month: parseInt(month),
					day: parseInt(day)
				},
				{ zone: timezone }
			);
		}
	}

	const match = icsDate.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?$/);
	if (match) {
		const [, year, month, day, hour = '00', minute = '00', second = '00'] = match;
		return DateTime.fromObject(
			{
				year: parseInt(year),
				month: parseInt(month),
				day: parseInt(day),
				hour: parseInt(hour),
				minute: parseInt(minute),
				second: parseInt(second)
			},
			{ zone: timezone }
		);
	}

	return DateTime.now();
}

function convertToTimezone(isoDate, timezone) {
	return DateTime.fromISO(isoDate)
		.setZone(timezone)
		.toISO();
}

function createGroupedEvents(events, days, timezone, requestUrl, startFrom = 'now') {
	const now = DateTime.now().setZone(timezone).startOf('day');
	const endDate = now.plus({ days });
	
	// Parse the startFrom parameter
	let cutoffDate;
	if (startFrom === 'now') {
		cutoffDate = now;
	} else {
		try {
			cutoffDate = DateTime.fromISO(startFrom).setZone(timezone).startOf('day');
			if (!cutoffDate.isValid) {
				throw new Error('Invalid date');
			}
		} catch (e) {
			console.warn('Invalid startFrom date, defaulting to now:', startFrom);
			cutoffDate = now;
		}
	}

	// Group events by date
	const groupedByDate = {};

	events.forEach(event => {
		const start = DateTime.fromISO(event.start).setZone(timezone);
		const end = DateTime.fromISO(event.end).setZone(timezone);

		// Skip events that end before cutoff date
		if (end < cutoffDate) return;

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

	// Return with request information
	return {
		agenda,
		timezone,
		request: {
			calendar: getCalendarDomain(requestUrl),
			days,
			requestedTimezone: timezone,
			startFrom: cutoffDate.toISO()
		}
	};
}
