# Coda CMS Framer Plugin

**Version 1.5.0**

A Framer plugin that allows you to connect your Coda documents as a data source for your Framer projects.

## Features

- **Connect to Coda documents** - Two connection modes:
  - **Browse Mode**: Select from a list of your docs and tables (requires unrestricted API token)
  - **Direct IDs Mode**: Enter Doc ID and Table ID manually (works with restricted API tokens)
- **Comprehensive field type support**:
  - Text, numbers, dates, links, images, files
  - **Select/Scale fields → Enum fields** (NEW in 1.5.0)
  - **Multi-value lookup fields → Cross-collection references** (NEW in 1.5.0)
- **Smart field mapping** - Map Coda columns to Framer CMS fields with automatic type detection
- **Enum preservation** - Select and Scale fields maintain their enum structure through re-sync
- **Cross-collection filtering** - Multi-value lookup fields enable filtering across related collections

## What's New in 1.5.0

### Enum Field Support
Coda **Select** and **Scale** fields now map to Framer's **Enum** fields, giving you proper dropdown filtering in the Framer CMS. Single-value **Lookup** fields also map to enums based on the unique values in your data.

### Cross-Collection Filtering
Multi-value **Lookup** fields in Coda now create **Multi-Collection Reference** fields in Framer, enabling powerful filtering across related collections. For example:
- A "Products" table with a lookup to "Categories" 
- Filter products by category directly in Framer's CMS interface
- **Note**: You must sync the referenced table (e.g., Categories) first, then sync the table with the lookup field (e.g., Products)

### Restricted API Token Support
You can now use restricted API tokens by entering Doc IDs and Table IDs directly:
1. Select "Direct IDs" mode on the API key screen
2. Enter your Doc ID (found in the doc URL: `coda.io/d/_d**OySK5JOQh-**`)
3. Enter your Table ID (right-click table → Copy table URL → extract from: `...#**grid-D-q_wRcl21**`)
4. Optionally provide a custom table name

### UI Improvements
- Radio button connection mode selector
- Two-column layout for easier direct ID entry
- Improved button hierarchy and layout
- Better help text and field hints

## Usage Tips

- **Enum fields**: Select and Scale columns in Coda automatically become filterable enums in Framer
- **Cross-collection references**: Sync the referenced table first, then sync tables with lookup fields to enable filtering
- **Restricted tokens**: Use Direct IDs mode if your API token is restricted to specific docs
- **Dates**: Empty date fields default to 12/31/1999
- **Button columns**: Automatically skipped (not used in Framer CMS)
- **Time format**: Toggle 12-hour/24-hour time format in the field mapping screen

## API Key Requirements

Get your API key from https://coda.io/developers/apis/v1

- **Browse Mode**: Requires an unrestricted API token (can read all your docs and tables)
- **Direct IDs Mode**: Works with restricted tokens (scoped to specific docs)

## Known Limitations

- Multi-value lookup fields require the referenced table to be synced first
- View-based syncs may not enable cross-collection filtering (sync base tables instead)
- Image columns from Coda don't work directly - use URL fields with image URLs instead

## Development

1. Install dependencies:
```bash
npm install
```

2. Start development server:
```bash
npm run dev
```

3. Build for production:
```bash
npm run build
```

## Testing

Run tests with:
```bash
npm test
```

## License

MIT
