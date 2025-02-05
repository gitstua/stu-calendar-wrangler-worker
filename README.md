# iCal to JSON Converter Worker

A Cloudflare Worker that converts iCal/ICS calendar feeds into a structured JSON format, with support for timezone conversion and multi-day events.

## Features

- Convert iCal/ICS feeds to JSON
- Filter events by number of days
- Timezone conversion support
- Handles all-day and multi-day events
- API key authentication
- CORS enabled

## License

This project is licensed under the [Creative Commons Attribution-NonCommercial 4.0 International License (CC BY-NC 4.0)](http://creativecommons.org/licenses/by-nc/4.0/). See the [LICENSE](LICENSE) file for details.

## Prerequisites

- Node.js (v16 or later)
- npm or yarn
- A Cloudflare account
- Wrangler CLI (Cloudflare Workers CLI)

## Setup

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd <repository-name>
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Install Wrangler CLI globally (if not already installed):
   ```bash
   npm install -g wrangler
   ```

4. Login to your Cloudflare account:
   ```bash
   wrangler login
   ```

5. Create a `.env` file in the project root:
   ```bash
   cp .env.example .env
   ```

6. Edit `.env` with your secret key:
   ```plaintext
   MASTER_KEY=your-secret-key-here
   ```

6. Update your `wrangler.toml` configuration:
   ```toml
   name = "your-worker-name"
   main = "src/index.js"
   compatibility_date = "2024-01-01"

   [vars]
   ENVIRONMENT = "production"

   # Enable Node.js compatibility
   compatibility_flags = ["nodejs_compat"]

   # Configure builds
   [build]
   command = "npm install"

   # Configure dev environment
   [dev]
   port = 8787

   # Configure logging
   [observability.logs]
   enabled = false
   ```

## Development

1. Generate an API key for testing:
   ```bash
   npm run generate-key
   ```

2. Run the development server:
   ```bash
   npm run dev
   ```

   or 

   ```bash
   wrangler dev
   ```

3. Run tests:
   ```bash
   npm test
   ```

## Deployment

1. Deploy to production:
   ```bash
   wrangler deploy
   ```

## API Usage

### Endpoint

GET https://stucal-92a1.workers.dev

### Example iCal File

You can find a sample iCal file [here](examples/sample.ics).

### Example JSON Output

The JSON output for the sample iCal file can be found [here](examples/sample-output.json).

### Headers

```
X-API-Key: your-api-key (begins with stucal_ and is 16 characters long)
```

### Query Parameters

- `url` (required): URL of the iCal/ICS feed
- `days` (optional): Number of days to fetch (default: 7)
- `timezone` (optional): Target timezone (default: UTC)

### Example Request

```bash
curl -X GET "https://<your-worker>.workers.dev?url=https://example.com/calendar.ics&days=7&timezone=America/New_York" \
  -H "X-API-Key: your-api-key"
```

### Example Response

```json
{
  "agenda": [
    {
      "date": "2024-01-01",
      "events": [
        {
          "title": "Sample Event",
          "start": "2024-01-01T10:00:00Z",
          "end": "2024-01-01T11:00:00Z",
          "description": "This is a sample event description.",
          "location": "Sample Location",
          "isFullDay": false
        }
      ]
    },
    {
      "date": "2024-01-02",
      "events": [
        {
          "title": "Another Event",
          "start": "2024-01-02T12:00:00Z",
          "end": "2024-01-02T13:00:00Z",
          "description": "This is another sample event description.",
          "location": "Another Location",
          "isFullDay": false
        }
      ]
    }
  ],
  "timezone": "UTC"
}
```

## Creating a New Cloudflare Worker

If you want to create a new worker from scratch:

1. Create a new directory and initialize:
   ```bash
   mkdir my-calendar-worker
   cd my-calendar-worker
   npm init
   ```

2. Install Wrangler:
   ```bash
   npm install -D wrangler
   ```

3. Create a new Worker project:
   ```bash
   npx wrangler init
   ```

4. Install dependencies:
   ```bash
   npm install luxon
   ```

5. Copy the source files from this repository:
   - `src/index.js`
   - `test/index.spec.js`
   - `scripts/generate-api-key.js`

6. Update your `wrangler.toml` configuration:
   ```toml
   name = "your-worker-name"
   main = "src/index.js"
   compatibility_date = "2024-01-01"

   [vars]
   ENVIRONMENT = "production"

   # Enable Node.js compatibility
   compatibility_flags = ["nodejs_compat"]

   # Configure builds
   [build]
   command = "npm install"

   # Configure dev environment
   [dev]
   port = 8787

   # Configure logging
   [observability.logs]
   enabled = false
   ```

## Troubleshooting

### API Key
- If you encounter issues with the API key, you can generate a new one by running `./scripts/generate-key.sh`.
- Make sure you have set the MASTER_KEY in the `.env` file.

### ical
This has been tested only with Google Calendar feeds.

Check 

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

For support, please open an issue in the GitHub repository.
