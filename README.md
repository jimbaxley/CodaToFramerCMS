# Coda CMS Framer Plugin

A Framer plugin that allows you to connect your Coda documents as a data source for your Framer projects.

## Features

- Connect to Coda documents using API key - see https://coda.io/developers/apis/v1 for details
- Select tables as data sources
- Map Coda fields to Framer fields
- Support for various field types including text, numbers, dates, links, and more

## Notes
- Dates will revert to 12/31/1999 if a synced date field is empty
- CODA API key required -  see https://coda.io/developers/apis/v1 for details. The scope of the key needs to be unrestricted to allow for Doc and Table selection.
- Button fields are skipped (they aren't used in Framer)

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
