# Coda CMS Framer Plugin

A Framer plugin that allows you to connect your Coda documents as a data source for your Framer projects.

## Features

- Connect to Coda documents using API key - see https://coda.io/developers/apis/v1 for details
- Select tables as data sources
- Map Coda fields to Framer fields
- Support for various field types including text, numbers, dates, links, and more
- Support for images using the ImageURL Coda Pack (https://coda.io/packs/imageurl-10797)

## Notes
- Dates will revert to 12/31/1999 if a synced date field is empty
- CODA API key required -  see https://coda.io/developers/apis/v1 for details
- Images must be a URL. Create a helper column in Coda using the ImageURL Coda Pack (https://coda.io/packs/imageurl-10797)

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
