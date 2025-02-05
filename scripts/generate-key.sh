#!/bin/bash

set -e  # Exit on error

echo "API Key Generator"
echo "----------------"

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "Error: .env file not found"
    exit 1
fi

# Prompt for the expiry date
default_expiry=$(date -v+1m +%Y-%m-%d 2>/dev/null || date -d "+1 month" +%Y-%m-%d)

read -p "Enter the expiry date (YYYY-MM-DD, default: $default_expiry): " expiry
if [ -z "$expiry" ]; then
    echo "No expiry date provided, using default: $default_expiry"
    expiry=$default_expiry
fi

echo "Generating key..."

# Run the Node.js script with the expiry date
DOTENV_CONFIG_PATH=".env" \
node -r dotenv/config scripts/generate-api-key.js "$expiry" 