import {
    type ManagedCollectionFieldInput,
    type FieldDataEntryInput,
    type ManagedCollection,
    type ManagedCollectionItemInput,
    framer
} from "framer-plugin"
import { marked } from "marked";
import DOMPurify from "dompurify";

interface WebPage {
    '@type': 'WebPage';
    url: string;
}

interface ValueWrapper {
    rawValue?: unknown;
    value?: unknown;
    displayValue?: unknown;
    name?: unknown;
    content?: unknown;
}

interface CodaApiResponse<T> {
    items: T[];
    href: string;
    syncToken?: string;
}

interface CodaRow {
    id: string;
    createdAt: string;
    updatedAt: string;
    values: Record<string, unknown>;
}

interface MonetaryAmount {
    '@type': 'MonetaryAmount';
    amount: number;
}

interface ImageObject {
    '@type': 'ImageObject';
    url?: string;
    contentUrl?: string;
    thumbnailUrl?: string;
}

export const PLUGIN_KEYS = {
    DATA_SOURCE_ID: "dataSourceId",
    SLUG_FIELD_ID: "slugFieldId",
    CODA_TABLE_ID: "codaTableId",
} as const

/**
 * Find a managed collection that was synced from a specific Coda table
 * Note: Coda lookup fields reference base table IDs, but users may sync views.
 * This function tries to match both exact IDs and related table references.
 */
async function findCollectionByCodaTableId(codaTableId: string): Promise<{ id: string, name: string } | null> {
    try {
        const collections = await framer.getManagedCollections();
        
        // First pass: try exact match
        for (const collection of collections) {
            const storedTableId = await collection.getPluginData(PLUGIN_KEYS.CODA_TABLE_ID);
            if (storedTableId === codaTableId) {
                return { id: collection.id, name: collection.name };
            }
        }
        
        // Second pass: Check if any collection's stored table ID could be a view of the requested table
        // This handles cases where lookup fields reference base tables but users sync views
        for (const collection of collections) {
            const storedTableId = await collection.getPluginData(PLUGIN_KEYS.CODA_TABLE_ID);
            const apiKey = await collection.getPluginData('apiKey');
            const docId = await collection.getPluginData('docId');
            
            if (!storedTableId || !apiKey || !docId) continue;
            
            // Skip non-table IDs (e.g., canvas IDs from old syncs)
            if (storedTableId.startsWith('canvas-') || !storedTableId.startsWith('grid-')) {
                continue;
            }
            
            // Fetch the table metadata for the stored table to see if it references the requested table
            try {
                const tableUrl = `https://coda.io/apis/v1/docs/${docId}/tables/${storedTableId}`;
                const response = await fetch(tableUrl, {
                    headers: { 'Authorization': `Bearer ${apiKey}` }
                });
                
                if (response.ok) {
                    const tableData = await response.json() as {
                        id: string,
                        name: string,
                        parent?: { id: string, type: string },
                        parentTable?: { id: string, type: string },
                        [key: string]: unknown
                    };
                    
                    // Check if this table's parent is the table we're looking for
                    const parentId = tableData.parent?.id || tableData.parentTable?.id;
                    if (parentId === codaTableId) {
                        return { id: collection.id, name: collection.name };
                    }
                }
            } catch (err) {
                // Silently continue if we can't fetch metadata
            }
        }
        
        return null;
    } catch (error) {
        console.error('Error finding collection by Coda table ID:', error);
        return null;
    }
}

export interface DataSource {
    id: string
    name?: string
    fields: readonly ManagedCollectionFieldInput[]
    items: Record<string, FieldDataEntryInput>[]
}

export interface GetDataSourceResult {
    dataSource: DataSource;
    showImageUrlWarning: boolean;
    codaColumns?: Array<{ id: string, format: { type: string } }>;
    codaTableId?: string; // The actual Coda table ID from the API
}

/**
 * Retrieve data and process it into a structured format.
 *
 * @example
 * {
 *   id: "articles",
 *   fields: [
 *     { id: "title", name: "Title", type: "string" },
 *     { id: "content", name: "Content", type: "formattedText" }
 *   ],
 *   items: [
 *     { title: "My First Article", content: "Hello world" },
 *     { title: "Another Article", content: "More content here" }
 *   ]
 * }
 */
export async function getDataSource(abortSignal?: AbortSignal): Promise<GetDataSourceResult> { // Modified return type
    // Get existing Coda settings from plugin data
    const collection = await framer.getActiveManagedCollection();
    const [apiKey, docId, tableId, tableName] = await Promise.all([
        collection.getPluginData('apiKey'),
        collection.getPluginData('docId'),
        collection.getPluginData('tableId'),
        collection.getPluginData('tableName')
    ]);
    
    if (!apiKey || !docId || !tableId) {
        throw new Error('Missing Coda configuration. Please configure the plugin first.')
    }

    // Use the existing getCodaDataSource function to fetch data
    return getCodaDataSource(apiKey, docId, tableId, tableName || undefined, abortSignal); // Will now return GetDataSourceResult
}

interface CodaColumn {
    id: string;
    name: string;
    display?: boolean;
    format: {
        type: string;
        isArray?: boolean;
        table?: {
            id?: string;
            type?: string;
        };
        options?: {
            choices?: Array<{
                name: string;
                id?: string;
            }>;
        };
    };
}

/**
 * Extracts meaningful text from a Coda value, handling schema.org objects and common wrappers.
 * @param item - The value to extract text from.
 * @returns A string representation suitable for Framer.
 */
function extractMeaningfulText(item: unknown): string {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object' && !Array.isArray(item)) {
        const obj = item as ValueWrapper;
        // Specifically handle schema.org WebPage objects for URLs (e.g., email addresses)
        if ('url' in obj && typeof (obj as WebPage).url === 'string' && (obj as WebPage)['@type'] === 'WebPage') {
            return (obj as WebPage).url;
        }
        // General object property extraction logic
        return (
            (typeof obj.rawValue === 'string' && obj.rawValue) || 
            (typeof obj.value === 'string' && obj.value) ||
            (typeof obj.displayValue === 'string' && obj.displayValue) ||
            (typeof obj.name === 'string' && obj.name) ||
            (typeof obj.content === 'string' && obj.content) // For rich text / canvas like objects
            || String(item) // Fallback: full stringification (might give [object Object])
        );
    }
    return String(item); // For primitives or if not an object
}

/**
 * Helper: check if a string is a likely image URL (common extensions)
 */
function isLikelyImageUrl(url: string): boolean {
    if (typeof url !== 'string') return false;
    const trimmed = url.trim();
    // Accepts .jpg, .jpeg, .png, .gif, .webp, .svg, .bmp, .tiff, .ico, .apng, .avif
    // OR any codahosted.io URL (with or without extension)
    return (
        /^https?:\/\/[\S]+\.(jpe?g|png|gif|webp|svg|bmp|tiff?|ico|apng|avif)(\?.*)?$/i.test(trimmed) ||
        /^https?:\/\/codahosted\.io\//.test(trimmed)
    );
}

/**
 * Helper function to map Coda types to Framer types
 */
function mapCodaTypeToFramerType(column: CodaColumn): ManagedCollectionFieldInput | null {
    const baseType = column.format.type.toLowerCase();
    const name = column.name.toLowerCase();
    const id = column.id.toLowerCase();
    
    // Skip button type columns
    if (baseType === 'button') {
        return null;
    }

    // Map as image if Coda type is 'image' or name/id contains 'image' or 'graphic'
    if (
        baseType === 'image' ||
        name.includes('image') ||
        name.includes('graphic') ||
        id.includes('image') ||
        id.includes('graphic')
    ) {
        return {
            id: column.id,
            name: column.name,
            type: 'image',
        };
    }
    // Enum mapping: if select/scale and has options array, create enum field with cases
    if ((baseType === 'select' || baseType === 'scale') && Array.isArray(column.format.options)) {
        const choices = column.format.options;
        return {
            id: column.id,
            name: column.name,
            type: 'enum',
            cases: choices.map((choice, idx) => ({
                id: choice.id || choice.name || `choice-${idx}`,
                name: choice.name
            }))
        };
    }
    switch (baseType) {
        case 'text':
        case 'email':
        case 'phone':
            return {
                id: column.id,
                name: column.name,
                type: 'string'
            }
        case 'number':
        case 'currency':
        case 'percent':
        case 'duration':
            return {
                id: column.id,
                name: column.name,
                type: 'number'
            }
        case 'checkbox':
            return {
                id: column.id,
                name: column.name,
                type: 'boolean'
            }
        case 'date': // Coda date-only
            return {
                id: column.id,
                name: column.name,
                type: 'date' // Framer date type
            }
        case 'datetime': // Coda date with time
            return {
                id: column.id,
                name: column.name,
                type: 'date' // Framer date type (will store full ISO string with time)
            }
        case 'time': // Coda time-only
             return {
                id: column.id,
                name: column.name,
                type: 'string' // Framer string type for time-only values
            }
        case 'image':
            return {
                id: column.id,
                name: column.name,
                type: 'image'
            }
        case 'file':
            return {
                id: column.id,
                name: column.name,
                type: 'file',
                allowedFileTypes: ['*']
            }
        case 'canvas':
        case 'richtext':
            // Removed debug log for mapping richtext/canvas fields
            return {
                id: column.id,
                name: column.name,
                type: 'formattedText'
            }
        case 'person':
        case 'lookup':
        case 'reference':
            // For single-value lookup fields, return enum type (cases will be populated from actual data)
            // Multi-value lookup fields (isArray: true) stay as strings with comma-separated values
            if (column.format.type.toLowerCase() === 'lookup' && !column.format.isArray) {
                return {
                    id: column.id,
                    name: column.name,
                    type: 'enum',
                    cases: [] // Will be populated with unique values from data
                };
            }
            // For person/reference/multi-value lookup fields, keep as string
            return {
                id: column.id,
                name: column.name,
                type: 'string'
            }
        case 'url':
        case 'link':
            return {
                id: column.id,
                name: column.name,
                type: 'link'
            }
        default:
            // Only warn for truly unsupported types
            // console.warn(`Unsupported Coda type "${baseType}", falling back to string`)
            return {
                id: column.id,
                name: column.name,
                type: 'string'
            }
    }
}

// Helper function to transform Coda values to Framer values
const ALLOWED_TAGS = [
    'h1','h2','h3','h4','h5','h6',
    'p','a','ul','ol','li','strong','em','img',
    'table','thead','tbody','tr','th','td',
    'blockquote','code','pre','br','hr','span'
];

function markdownToSanitizedHtml(md: string): string {
    // Use marked.parse synchronously with proper typing
    const rawHtml = marked.parse(md, { async: false }) as string;
    // DOMPurify only allows a subset of config, so we use ALLOWED_TAGS and basic attributes
    return DOMPurify.sanitize(rawHtml, {
        ALLOWED_TAGS,
        ALLOWED_ATTR: [
            'href', 'name', 'target', 'rel',
            'src', 'alt', 'title', 'width', 'height',
            'colspan', 'rowspan', 'style'
        ]
    });
}

function transformCodaValue(value: unknown, field: ManagedCollectionFieldInput, codaColumnType: string, use12HourTime?: boolean): FieldDataEntryInput | null {
    // 1. Handle null/undefined/empty based on Framer field.type
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
        switch (field.type) {
            case 'string':
                return { type: 'string', value: '' };
            case 'number':
                return { type: 'number', value: 0 }; 
            case 'boolean':
                return { type: 'boolean', value: false };
            case 'date':
                return null; // Leave date blank if source is null/undefined/empty
            case 'image':
                return { type: 'image', value: '' }; // Value is string URL
            case 'file':
                return { type: 'file', value: '' }; // Value is string URL
            case 'formattedText':
                return { type: 'formattedText', value: '' };
            case 'link':
                return { type: 'link', value: '' }; // Value is string URL/href
            case 'collectionReference':
                return { type: 'collectionReference', value: '' }; // Value is single string ID
            case 'multiCollectionReference':
                return { type: 'multiCollectionReference', value: [] }; // Value is array of string IDs
            case 'enum':
                return { type: 'enum', value: '' }; // Empty enum value
            default:
                console.warn(`Unknown field type "${field.type}" for null/undefined/empty value. Defaulting to empty string.`);
                return { type: 'string', value: '' };
        }
    }

    // 2. Main switch on field.type (Framer type)
    switch (field.type) {
        case 'number': {
            let numericValue: number;
            if (typeof value === 'number') {
                numericValue = value;
            } else if (typeof value === 'string') {
                // Remove currency symbols, commas, and handle percentages
                let cleanValue = value
                    .replace(/[$£€¥]/g, '') // Remove common currency symbols
                    .replace(/,/g, '')      // Remove commas
                    .trim();
                
                // Handle percentage values
                if (cleanValue.endsWith('%')) {
                    cleanValue = cleanValue.slice(0, -1);
                    const parsed = Number(cleanValue);
                    if (!isNaN(parsed)) {
                        numericValue = parsed / 100; // Convert percentage to decimal
                    } else {
                        console.warn(`Could not parse percentage value "${value}" for field ${field.name}. Falling back to 0.`);
                        numericValue = 0;
                    }
                } else {
                    const parsed = Number(cleanValue);
                    if (!isNaN(parsed)) {
                        numericValue = parsed;
                    } else {
                        console.warn(`Could not parse numeric value "${value}" for field ${field.name}. Falling back to 0.`);
                        numericValue = 0;
                    }
                }
            } else if (typeof value === 'object' && value !== null) {
                // Handle schema.org MonetaryAmount format
                const monetaryAmount = value as MonetaryAmount;
                if (monetaryAmount['@type'] === 'MonetaryAmount' && typeof monetaryAmount.amount === 'number') {
                    numericValue = monetaryAmount.amount;
                }
                // Handle simple value wrapper object
                else if ('value' in value && typeof value.value === 'number') {
                    numericValue = value.value;
                }
                // Handle raw number in object
                else if ('amount' in value && typeof value.amount === 'number') {
                    numericValue = value.amount;
                } else {
                    console.warn(`Unexpected object value for number field ${field.name}: ${JSON.stringify(value)}. Falling back to 0.`);
                    numericValue = 0;
                }
            } else {
                console.warn(`Unexpected value type for number field ${field.name}: ${JSON.stringify(value)}. Falling back to 0.`);
                numericValue = 0;
            }
            return { type: 'number', value: numericValue };
        }
        case 'boolean':
            return { type: 'boolean', value: Boolean(value) };
        case 'date': 
            try {
                let dateValue: string | number | Date = (typeof value === "string" || typeof value === "number" || value instanceof Date)
                    ? value
                    : "";
                if (typeof value === 'object' && value !== null && 'value' in value) {
                    const v = (value as { value: unknown }).value;
                    dateValue = (typeof v === "string" || typeof v === "number" || v instanceof Date) ? v : "";
                }
                const dateObj = new Date(String(dateValue));
                if (isNaN(dateObj.getTime())) {
                    console.warn(`Invalid date value encountered for field ${field.name}: ${String(dateValue)}. Leaving blank.`);
                    return null; // Leave date blank if invalid
                }

                // Handle Coda 'date' (date-only) type
                if (codaColumnType === 'date') {
                    // Format as YYYY-MM-DD for Framer's date type
                    const year = dateObj.getUTCFullYear();
                    const month = (dateObj.getUTCMonth() + 1).toString().padStart(2, '0');
                    const day = dateObj.getUTCDate().toString().padStart(2, '0');
                    return { type: 'date', value: `${year}-${month}-${day}` };
                }

                // Handle Coda 'datetime' and 'time' types
                if (codaColumnType === 'datetime' || codaColumnType === 'time') {
                    if (codaColumnType === 'time') {
                        // For time-only, Framer still expects a full ISO string for the 'date' type.
                        // Extract time parts from the original ISO string to maintain UTC time for storage
                        const isoDate = dateObj.toISOString();
                        const timePart = isoDate.split('T')[1];
                        return {
                            type: 'date',
                            value: `1970-01-01T${timePart}`
                        };
                    }

                    // For 'datetime', preserve the local date/time but format as UTC to avoid timezone shifts
                    // This prevents "Sept 30 8PM EDT" from becoming "Oct 1 midnight UTC" in Framer's display
                    const year = dateObj.getFullYear();
                    const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
                    const day = dateObj.getDate().toString().padStart(2, '0');
                    const hours = dateObj.getHours().toString().padStart(2, '0');
                    const minutes = dateObj.getMinutes().toString().padStart(2, '0');
                    const seconds = dateObj.getSeconds().toString().padStart(2, '0');
                    const ms = dateObj.getMilliseconds().toString().padStart(3, '0');
                    
                    const localAsUtcValue = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${ms}Z`;
                    return {
                        type: 'date',
                        value: localAsUtcValue
                    };
                }

                // Default for other date-like values (should ideally be covered by 'date' or 'datetime')
                return { type: 'date', value: dateObj.toISOString() };

            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                console.warn(`Error parsing date value for field ${field.name}: ${value} (Error: ${errorMessage}). Leaving blank.`);
                return null; // Leave date blank on error
            }
        case 'formattedText': 
            if (codaColumnType === 'canvas' || codaColumnType === 'richtext') {
                let md = '';
                if (typeof value === 'object' && value !== null) {
                    if ('content' in value && typeof value.content === 'string') {
                        md = value.content;
                    } else if ('value' in value && typeof value.value === 'string') {
                        md = value.value;
                    } else {
                        const serialized = JSON.stringify(value);
                        if (serialized !== '{}') md = serialized;
                    }
                } else if (typeof value === 'string') {
                    md = value;
                }
                // Convert markdown to sanitized HTML
                return { type: 'formattedText', value: markdownToSanitizedHtml(md) };
            }
            return { type: 'formattedText', value: String(value) };
        // For all other string-like fields, strip markdown
        case 'string': {
            if (codaColumnType === 'time') {
                try {
                    let hours: number | undefined, minutes: number | undefined, secondsVal: number | undefined;
                    let successfullyParsed = false;

                    if (typeof value === 'string') {
                        // Try to match "HH:mm" or "HH:mm:ss"
                        const timeOnlyMatch = value.match(/^([0-1]?\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/);
                        if (timeOnlyMatch) {
                            hours = parseInt(timeOnlyMatch[1]!, 10);
                            minutes = parseInt(timeOnlyMatch[2]!, 10);
                            secondsVal = timeOnlyMatch[4] ? parseInt(timeOnlyMatch[4], 10) : 0;
                            successfullyParsed = true;
                        } else {
                            // If not a simple time string, try parsing as a full date string
                            const dateObj = new Date(value);
                            if (!isNaN(dateObj.getTime())) {
                                hours = dateObj.getHours();
                                minutes = dateObj.getMinutes();
                                secondsVal = dateObj.getSeconds();
                                successfullyParsed = true;
                            }
                        }
                    } else if (value instanceof Date) {
                        hours = value.getHours();
                        minutes = value.getMinutes();
                        secondsVal = value.getSeconds();
                        successfullyParsed = true;
                    }

                    if (successfullyParsed && hours !== undefined && minutes !== undefined && secondsVal !== undefined) {
                        let formattedTime: string;
                        if (use12HourTime) {
                            const ampm = hours >= 12 ? 'PM' : 'AM';
                            const formattedHours = hours % 12 || 12;
                            formattedTime = `${formattedHours}:${minutes.toString().padStart(2, '0')}`;
                            if (secondsVal > 0) {
                               formattedTime += `:${secondsVal.toString().padStart(2, '0')}`;
                            }
                            formattedTime += ` ${ampm}`;
                        } else {
                            formattedTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
                            if (secondsVal > 0) {
                               formattedTime += `:${secondsVal.toString().padStart(2, '0')}`;
                            }
                        }
                        return { type: 'string', value: formattedTime };
                    } else {
                        // Fall through to generic string processing if specific time parsing fails
                    }
                } catch {
                    // Swallow error, fall through to generic string processing
                }
            }

            // General string processing (also serves as fallback for 'time' if parsing/formatting fails)
            let textValue = '';
            // For debugging text fields only (removed log)
            // if (codaColumnType === 'text') {
            //     console.log(`[Text Processing] Field "${field.name}" metadata:`, ...)
            // }

            interface RawValueContainer { rawValue: unknown[] }
            if (Array.isArray(value) || (value && typeof value === 'object' && 'rawValue' in value && Array.isArray((value as RawValueContainer).rawValue))) {
                const arr = Array.isArray(value) ? value : (value as RawValueContainer).rawValue;
                textValue = arr
                    .map(extractMeaningfulText)
                    .filter(Boolean)
                    .join(', ');
            } else {
                textValue = extractMeaningfulText(value);
            }

            return { type: 'string', value: stripMarkdown(textValue) };
        } // End case 'string'
        case 'image': {
            let imageUrl = '';
            // Handle string values (direct URLs or markdown)
            if (typeof value === 'string') {
                imageUrl = extractUrlFromMarkdown(value);
            }
            // Handle schema.org ImageObject and other object values
            else if (typeof value === 'object' && value !== null) {
                // Handle schema.org ImageObject format
                // Handle array of ImageObjects
                if (Array.isArray(value)) {
                    for (const item of value) {
                        if (item['@type'] === 'ImageObject') {
                            const urls = [item.url, item.contentUrl, item.thumbnailUrl].filter(u => typeof u === 'string');
                            for (const url of urls) {
                                if (isValidAssetUrl(url) || isLikelyImageUrl(url)) {
                                    imageUrl = url;
                                    break;
                                }
                            }
                            if (imageUrl) break;
                        }
                    }
                }
                // Handle single ImageObject
                else {
                    const obj = value as ImageObject;
                    if (obj['@type'] === 'ImageObject') {
                        const possibleUrls = [
                            typeof obj.url === 'string' ? obj.url : null,
                            typeof obj.contentUrl === 'string' ? obj.contentUrl : null,
                            typeof obj.thumbnailUrl === 'string' ? obj.thumbnailUrl : null
                        ].filter((url): url is string => url !== null);
                        
                        for (const url of possibleUrls) {
                            if (isValidAssetUrl(url) || isLikelyImageUrl(url)) {
                                imageUrl = url;
                                break;
                            }
                        }
                    }
                }
                // Check all possible URL locations in the object
                if ('url' in value && typeof value.url === 'string') {
                    imageUrl = value.url;
                } else if ('link' in value && typeof value.link === 'string') {
                    imageUrl = value.link;
                } else if ('value' in value && typeof value.value === 'string') {
                    // Handle nested value objects
                    imageUrl = extractUrlFromMarkdown(value.value);
                } else if ('rawValue' in value && typeof value.rawValue === 'string') {
                    // Handle raw values that might contain URLs
                    imageUrl = extractUrlFromMarkdown(value.rawValue);
                } else if ('imageUrl' in value && typeof value.imageUrl === 'string') {
                    // Direct image URL property
                    imageUrl = value.imageUrl;
                } else if ('thumbnailUrl' in value && typeof value.thumbnailUrl === 'string') {
                    // Fallback to thumbnail if available
                    imageUrl = value.thumbnailUrl;
                }
                
                // Handle linked record cases
                if (!imageUrl && 'linkedRow' in value && typeof value.linkedRow === 'object' && value.linkedRow !== null) {
                    const linkedRow = value.linkedRow;
                    if ('url' in linkedRow && typeof linkedRow.url === 'string') {
                        imageUrl = linkedRow.url;
                    } else if ('imageUrl' in linkedRow && typeof linkedRow.imageUrl === 'string') {
                        imageUrl = linkedRow.imageUrl;
                    }
                }
            }

            // Validate and return the image URL
            if (imageUrl && (isValidAssetUrl(imageUrl) || isLikelyImageUrl(imageUrl))) {
                return { type: 'image', value: imageUrl.trim() };
            }

            // Log warning for invalid/missing URLs (keep, as this is user-actionable)
            if (!(imageUrl && (isValidAssetUrl(imageUrl) || isLikelyImageUrl(imageUrl)))) {
                // Only warn if the user mapped a field as image but no valid URL was found
                // (Keep this warning)
                console.warn(`Invalid or missing image URL for field ${field.name}:`, { 
                    rawValue: value,
                    processedUrl: imageUrl || '(none)',
                    validUrl: Boolean(imageUrl && isValidAssetUrl(imageUrl)),
                    likelyImage: Boolean(imageUrl && isLikelyImageUrl(imageUrl))
                });
            }
            return null;
        }
        case 'file': {
            let fileUrl = '';
            if (typeof value === 'string') {
                fileUrl = extractUrlFromMarkdown(value);
            } else if (typeof value === 'object' && value !== null) {
                if ('url' in value && typeof value.url === 'string') {
                    fileUrl = value.url;
                } else if ('link' in value && typeof value.link === 'string') { 
                    fileUrl = value.link;
                }
            }
            if (fileUrl && isValidAssetUrl(fileUrl)) {
                return { type: 'file', value: fileUrl.trim() }; 
            }
            // Only warn if the user mapped a field as file but no valid URL was found
            console.warn(`Unsupported or non-absolute file value for field ${field.name}: '${fileUrl}'. Skipping asset.`, { value });
            return null;
        }
        case 'link': { 
            let linkUrl = '';
            if (typeof value === 'object' && value !== null && 'url' in value && typeof value.url === 'string') {
                linkUrl = value.url;
            } else if (typeof value === 'string') { 
                linkUrl = value;
            }
            if (linkUrl) {
                return { type: 'link', value: linkUrl }; 
            }
            // Only warn if the user mapped a field as link but no valid URL was found
            console.warn(`Unsupported link value for field ${field.name}: ${JSON.stringify(value)}. Falling back to empty link URL.`);
            return { type: 'link', value: '' };
        }
        
        case 'collectionReference': { 
            let finalItemId = '';
            const processItem = (item: unknown): string | null => {
                if (typeof item === 'string') return item;
                if (typeof item === 'object' && item !== null) {
                    const obj = item as Record<string, unknown>;
                    if ('id' in obj && typeof obj.id === 'string') return obj.id;
                    if ('@id' in obj && typeof obj['@id'] === 'string') return obj['@id'];
                }
                return null;
            };
            if (Array.isArray(value)) { 
                const firstValidId = value.map(processItem).find(id => id !== null);
                if (firstValidId) finalItemId = firstValidId;
            } else { 
                const singleId = processItem(value);
                if (singleId) finalItemId = singleId;
            }
            return { type: 'collectionReference', value: finalItemId }; 
        }

        case 'multiCollectionReference': {
            // Extract IDs from lookup field values (array of row references)
            const itemIds: string[] = [];
            const processItem = (item: unknown): string | null => {
                if (typeof item === 'string') return item;
                if (typeof item === 'object' && item !== null) {
                    const obj = item as Record<string, unknown>;
                    // Coda lookup values use rowId property for the referenced row's ID
                    if ('rowId' in obj && typeof obj.rowId === 'string') return obj.rowId;
                    if ('id' in obj && typeof obj.id === 'string') return obj.id;
                    if ('@id' in obj && typeof obj['@id'] === 'string') return obj['@id'];
                }
                return null;
            };
            
            if (Array.isArray(value)) {
                value.forEach(item => {
                    const id = processItem(item);
                    if (id) itemIds.push(id);
                });
            } else {
                const id = processItem(value);
                if (id) itemIds.push(id);
            }
            
            return { type: 'multiCollectionReference', value: itemIds };
        }

        case 'enum': {
            // Handle enum values from Coda select/scale fields and lookup fields
            let enumValue = '';
            
            // If value is an object with name property (Coda's select/lookup format)
            if (typeof value === 'object' && value !== null && 'name' in value) {
                const obj = value as Record<string, unknown>;
                if (typeof obj.name === 'string') {
                    enumValue = obj.name;
                } else if ('id' in obj && typeof obj.id === 'string') {
                    enumValue = obj.id;
                }
            } 
            // If it's already a string, use it directly
            else if (typeof value === 'string') {
                enumValue = value;
            }
            // If it's an array (lookup fields can be multi-value), take the first valid value
            else if (Array.isArray(value) && value.length > 0) {
                const firstItem = value[0];
                if (typeof firstItem === 'object' && firstItem !== null && 'name' in firstItem) {
                    enumValue = String(firstItem.name);
                } else if (typeof firstItem === 'string') {
                    enumValue = firstItem;
                }
            }
            
            // Strip markdown code block formatting if present
            if (enumValue) {
                enumValue = enumValue.replace(/^```|```$/g, '').trim();
            }

            // Try to match with the field's cases if available
            if ('cases' in field && Array.isArray(field.cases) && enumValue) {
                // First try to find by ID
                const matchingCase = field.cases.find(c => c.id === enumValue);
                if (matchingCase) {
                    return { type: 'enum', value: matchingCase.id };
                }
                // If not found by ID, try to find by name
                const matchingCaseByName = field.cases.find(c => c.name === enumValue);
                if (matchingCaseByName) {
                    return { type: 'enum', value: matchingCaseByName.id };
                }
            }

            // Return the value as-is if we have something
            if (enumValue) {
                return { type: 'enum', value: enumValue };
            }

            // Return null for no value - field will be skipped during sync
            return null;
        }

        default:
            // Only warn for truly unhandled types
            console.warn(
                `Unhandled Framer field type "${field.type}" in transformCodaValue ` +
                `for Coda column type "${codaColumnType}" and value: ${JSON.stringify(value)}. ` +
                `Falling back to string representation.`
            );
            return { type: 'string', value: String(value) };
    }
}

// Utility to unwrap markdown code block/backtick formatting and clean up links
function stripMarkdown(text: string): string {
    let newText = text;

    // Remove markdown links, prefer URL if it's a mailto link and text is the email, otherwise prefer the link text.
    // Example: [user@example.com](mailto:user@example.com) -> user@example.com
    // Example: [user@example.com](user@example.com) -> user@example.com
    // Example: [Click here](http://example.com) -> Click here
    // Example: [Click here](mailto:user@example.com) -> Click here
    newText = newText.replace(/\[([^\]]+)]\(([^)]+)\)/g, (_match, linkText, linkUrl) => {
        if (linkUrl.startsWith('mailto:')) {
            const emailFromUrl = linkUrl.substring(7);
            if (linkText.toLowerCase() === emailFromUrl.toLowerCase()) {
                return emailFromUrl; // Return just the email if text and mailto email match
            }
            // If link text is different from the email in mailto, prefer the link text
            // e.g. [Contact Us](mailto:support@example.com) -> "Contact Us"
            return linkText; 
        } else if (linkText.toLowerCase() === linkUrl.toLowerCase()) {
            // Handles cases like [user@example.com](user@example.com)
            return linkText;
        }
        return linkText; // Otherwise, return the link text
    });
    // Globally unwrap triple backticks, trimming the content within them.
    newText = newText.replace(/```([\s\S]*?)```/g, (_match, group1) => group1.trim());
    // Globally unwrap single backticks (after triple), trimming the content within them.
    newText = newText.replace(/`([^`]*)`/g, (_match, group1) => group1.trim());
    return newText.trim();
}

// Utility to extract image/file URL from markdown or backticks
function extractUrlFromMarkdown(text: string): string {
    // Match markdown image: ![alt](url)
    const mdImg = text.match(/!\[[^\]]*\]\(([^)]+)\)/);
    if (mdImg && mdImg[1]) return mdImg[1].trim();
    // Unwrap backticks if present
    const triple = text.match(/^```([\s\S]*?)```$/);
    if (triple && typeof triple[1] === 'string') return triple[1].trim();
    const single = text.match(/^`([^`]*)`$/);
    if (single && typeof single[1] === 'string') return single[1].trim();
    return text.trim();
}

// Utility to check if a string is a valid image/file URL (http(s) or codahosted.io)
function isValidAssetUrl(url: string): boolean {
    const trimmed = url.trim();
    return (
        trimmed.startsWith('http://') ||
        trimmed.startsWith('https://') ||
        trimmed.includes('codahosted.io/')
    );
}

export async function getCodaDataSource(
    apiKey: string,
    docId: string,
    tableId: string,
    tableName?: string,
    signal?: AbortSignal
): Promise<GetDataSourceResult> {
    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
    }

    let hasImageOrFileFields = false;
    let hasValidImageOrFileUrls = false;

    // First, fetch the table metadata to get the actual Coda table ID
    const tableUrl = `https://coda.io/apis/v1/docs/${docId}/tables/${tableId}`
    const tableResponse = await fetch(tableUrl, {
        ...(signal ? { signal } : {}),
        headers
    })

    if (!tableResponse.ok) {
        throw new Error(`Failed to fetch table metadata from Coda: ${tableResponse.status}`)
    }

    const tableData = await tableResponse.json() as { 
        id: string, 
        name: string, 
        parent?: { id: string, type: string },
        parentTable?: { id: string, type: string },
        [key: string]: unknown 
    };
    
    // Use the table's own ID as the Coda table identifier
    const actualCodaTableId = tableData.id;

    // Now fetch the columns metadata
    const columnsUrl = `https://coda.io/apis/v1/docs/${docId}/tables/${tableId}/columns`
    const columnsResponse = await fetch(columnsUrl, {
        ...(signal ? { signal } : {}),
        headers
    })

    if (!columnsResponse.ok) {
        throw new Error(`Failed to fetch data from Coda: ${columnsResponse.status}`)
    }

    const columnsData = await columnsResponse.json() as CodaApiResponse<CodaColumn>;

    const columns = columnsData.items
        .map((col) => ({
            id: col.id,
            name: String(col.name || col.id),
            format: col.format
        }));

    // Fetch rows with rich text formatting
    const rowsUrl = `https://coda.io/apis/v1/docs/${docId}/tables/${tableId}/rows?useRichText=true&valueFormat=rich`
    const rowsResponse = await fetch(rowsUrl, {
        ...(signal ? { signal } : {}),
        headers,
    })

    if (!rowsResponse.ok) {
        const errorText = await rowsResponse.text()
        throw new Error(`Failed to fetch data from Coda: ${rowsResponse.status} ${errorText}`)
    }

    const rowsData = await rowsResponse.json() as CodaApiResponse<CodaRow>;

    // Remove debug logging for raw API response
    // console.log('Raw Coda API response:', {
    //     // firstRow: rowsData.items[0], // Removed unused variable
    //     rowStructure: Object.keys(rowsData.items[0]?.values || {})
    // });

    // const firstRow = rowsData.items[0]?.values || {}; // Removed unused variable

    // Discover referenced collections for lookup fields
    const lookupCollectionMap = new Map<string, { id: string, name: string }>();
    for (const col of columns) {
        if (col.format.type.toLowerCase() === 'lookup' && col.format.isArray && col.format.table?.id) {
            const referencedCollection = await findCollectionByCodaTableId(col.format.table.id);
            if (referencedCollection) {
                lookupCollectionMap.set(col.id, referencedCollection);
            } else {
                console.warn(`⚠ No Framer collection found for lookup field "${col.name}" (references Coda table ${col.format.table.id}). Sync that table first to enable cross-collection filtering.`);
            }
        }
    }

    // Instead of using only the first row, gather all values for each column
    // But now, sampleValues is not used for image detection, so we can just pass an empty array or undefined
    const fields = columns.map((col: CodaColumn) => {
        // Only use type/name/id for mapping
        let mappedField = mapCodaTypeToFramerType(col);
        
        // Convert multi-value lookup fields to multiCollectionReference if we found the referenced collection
        if (mappedField && mappedField.type === 'string' && col.format.type.toLowerCase() === 'lookup' && col.format.isArray) {
            const referencedCollection = lookupCollectionMap.get(col.id);
            if (referencedCollection) {
                mappedField = {
                    id: col.id,
                    name: col.name,
                    type: 'multiCollectionReference',
                    collectionId: referencedCollection.id
                };
            }
        }
        
        if (mappedField && (mappedField.type === 'image' || mappedField.type === 'file')) {
            hasImageOrFileFields = true;
        }
        return mappedField;
    }).filter((field): field is ManagedCollectionFieldInput => field !== null);

    // For lookup fields with enum type, collect unique values from all rows to create enum cases
    const lookupFields = fields.filter(f => f.type === 'enum' && columns.find(c => c.id === f.id && c.format.type.toLowerCase() === 'lookup'));
    if (lookupFields.length > 0) {
        // Collect unique values for each lookup field
        const lookupValueSets = new Map<string, Set<string>>();
        lookupFields.forEach(field => lookupValueSets.set(field.id, new Set()));

        rowsData.items.forEach(row => {
            lookupFields.forEach(field => {
                const value = row.values[field.id];
                if (!value) return;

                const extractLookupValues = (v: unknown): string[] => {
                    const results: string[] = [];
                    if (Array.isArray(v)) {
                        v.forEach(item => {
                            if (typeof item === 'string') results.push(item);
                            else if (typeof item === 'object' && item !== null) {
                                if ('name' in item && typeof item.name === 'string') results.push(item.name);
                                else if ('value' in item && typeof item.value === 'string') results.push(item.value);
                            }
                        });
                    } else if (typeof v === 'object' && v !== null) {
                        if ('name' in v && typeof v.name === 'string') results.push(v.name);
                        else if ('value' in v && typeof v.value === 'string') results.push(v.value);
                    } else if (typeof v === 'string') {
                        results.push(v);
                    }
                    return results;
                };

                const values = extractLookupValues(value);
                const valueSet = lookupValueSets.get(field.id);
                values.forEach(v => valueSet?.add(v.replace(/^```|```$/g, '').trim()));
            });
        });

        // Populate cases for each lookup field
        lookupFields.forEach(field => {
            const uniqueValues = Array.from(lookupValueSets.get(field.id) || []).filter(v => v.length > 0);
            if ('cases' in field && Array.isArray(field.cases)) {
                field.cases = uniqueValues.map((value) => ({
                    id: value,
                    name: value
                }));
            }
        });
    }

    const fieldMap = new Map<string, ManagedCollectionFieldInput>(
        fields.map((field: ManagedCollectionFieldInput) => [field.id, field])
    )
    
    const codaColumnTypeMap = new Map<string, string>(
        columns.map((col: CodaColumn) => [col.id, col.format.type.toLowerCase()])
    )

    const use12HourTimePreferenceRaw = await framer.getPluginData("use12HourTimeFormat");
    const use12HourTimePreference = use12HourTimePreferenceRaw === "true";

    const items = rowsData.items.map((row: { id: string; values: Record<string, unknown> }) => {
        const fieldData: Record<string, FieldDataEntryInput> = {
            _id: {
                type: "string",
                value: row.id
            }
        }

        for (const [key, value] of Object.entries(row.values)) {
            const field = fieldMap.get(key)
            if (field) {
                const codaType = codaColumnTypeMap.get(key) || 'text';
                const transformedEntry = transformCodaValue(value, field, codaType, use12HourTimePreference)
                if (transformedEntry !== null) {
                    fieldData[key] = transformedEntry;
                    if (field.type === 'image' || field.type === 'file') {
                        if (transformedEntry.value && typeof transformedEntry.value === 'string' && transformedEntry.value.trim() !== '') {
                            hasValidImageOrFileUrls = true;
                        }
                    }
                }
            }
        }
        
        return fieldData
    })

    const showImageUrlWarning = hasImageOrFileFields && !hasValidImageOrFileUrls;

    return {
        dataSource: {
            id: tableId,
            name: tableName,
            fields,
            items,
        },
        showImageUrlWarning,
        codaColumns: columns,
        codaTableId: actualCodaTableId, // Store the actual Coda table ID
    }
}

export function mergeFieldsWithExistingFields(
    sourceFields: readonly ManagedCollectionFieldInput[],
    existingFields: readonly ManagedCollectionFieldInput[]
): ManagedCollectionFieldInput[] {
    const existingFieldMap = new Map(existingFields.map(field => [field.id, field]))
    
    return sourceFields.map(sourceField => {
        const existingField = existingFieldMap.get(sourceField.id)
        if (existingField) {
            // Keep the existing field's name, but use the source field's type and properties
            // This ensures enum fields maintain their structure on re-sync
            return { 
                ...sourceField,
                name: existingField.name
            }
        }
        // For new fields, use Coda's column ID as field ID and column name as display name
        return sourceField
    })
}

export async function syncCollection(
    collection: ManagedCollection,
    dataSourceResult: GetDataSourceResult,
    fields: ManagedCollectionFieldInput[],
    slugField: ManagedCollectionFieldInput
) {
    const { dataSource } = dataSourceResult;
    // Create a map of fields by ID for faster lookup
    const fieldMap = new Map(fields.map(field => [field.id, field]))
    
    // Get Coda column types for transformation
    const codaColumnTypeMap = new Map<string, string>();
    if (dataSourceResult.codaColumns) {
        dataSourceResult.codaColumns.forEach((col: { id: string, format: { type: string } }) => {
            codaColumnTypeMap.set(col.id, col.format.type.toLowerCase());
        });
    }
    
    // Get time format preference
    const use12HourTimePreferenceRaw = await framer.getPluginData("use12HourTimeFormat");
    const use12HourTimePreference = use12HourTimePreferenceRaw === "true";

    const items: ManagedCollectionItemInput[] = []
    const unsyncedItems = new Set(await collection.getItemIds())

    for (let i = 0; i < dataSource.items.length; i++) {
        const item = dataSource.items[i]
        if (!item) throw new Error("Logic error")

        // Use Coda's row ID as a unique identifier
        const rowId = (item._id && typeof item._id === 'object' && 'value' in item._id) ? 
            String(item._id.value) : undefined
        if (!rowId) {
            console.warn(`Skipping item at index ${i} because it doesn't have a row ID`)
            continue
        }

        const slugFieldData = item[slugField.id]
        const slugValue = typeof slugFieldData === "object" && slugFieldData && "value" in slugFieldData
            ? String(slugFieldData.value)
            : undefined

        if (!slugValue) {
            console.warn(`Skipping item at index ${i} because it doesn't have a valid slug`)
            continue
        }

        unsyncedItems.delete(rowId)

        const fieldData: Record<string, FieldDataEntryInput> = {}
        for (const [fieldId, value] of Object.entries(item)) {
            // Skip the special _id field
            if (fieldId === '_id') continue
            
            // Only include fields that are in our field map
            const field = fieldMap.get(fieldId)
            if (!field) continue

            if (typeof value === "object" && value !== null && "type" in value && "value" in value) {
                // Get the Coda column type for proper transformation
                const codaType = codaColumnTypeMap.get(fieldId) || 'text';
                
                // Transform the value using the same logic as getCodaDataSource
                const transformedValue = transformCodaValue(value.value, field, codaType, use12HourTimePreference);
                
                // Only add the field if transformation succeeded
                if (transformedValue !== null) {
                    fieldData[field.id] = transformedValue;
                }
            }
        }

        items.push({
            id: rowId,
            slug: slugValue,
            draft: false,
            fieldData,
        })
    }

    // Prepare fields for syncing - keep enum fields as-is
    const compatibleFields = fields.map((field: ManagedCollectionFieldInput) => {
        // Enum fields are now properly supported, so we keep them as enum
        if (field.type === 'enum') {
            return field;
        }
        // For multi-collection reference fields, ensure collectionId is present
        if (field.type === 'multiCollectionReference') {
            if (!('collectionId' in field) || typeof (field as { collectionId?: unknown }).collectionId !== 'string') {
                // Skip invalid multi-collection reference fields
                return null;
            }
        }
        return field;
    }).filter((field): field is ManagedCollectionFieldInput => !!field && typeof field.id === 'string' && typeof field.name === 'string' && typeof field.type === 'string');
    await collection.setFields([...compatibleFields])
    await collection.removeItems(Array.from(unsyncedItems))
    await collection.addItems(items)

    await collection.setPluginData(PLUGIN_KEYS.DATA_SOURCE_ID, dataSource.id)
    await collection.setPluginData(PLUGIN_KEYS.SLUG_FIELD_ID, slugField.id)
    
    // Store the actual Coda table ID (not the Framer collection ID)
    const codaTableIdToStore = dataSourceResult.codaTableId || dataSource.id;
    await collection.setPluginData(PLUGIN_KEYS.CODA_TABLE_ID, codaTableIdToStore)
}

export async function syncExistingCollection(
    collection: ManagedCollection,
    previousDataSourceId: string | null,
    previousSlugFieldId: string | null
): Promise<{ didSync: boolean }> {
    if (!previousDataSourceId) {
        return { didSync: false }
    }

    if (framer.mode !== "syncManagedCollection" || !previousSlugFieldId) {
        return { didSync: false }
    }

    try {
        const dataSourceResult = await getDataSource()
        const existingFields = await collection.getFields()
        
        // Merge existing fields with new data source fields to preserve enum structures
        const mergedFields = mergeFieldsWithExistingFields(dataSourceResult.dataSource.fields, existingFields);
        
        // Validate fields
        const compatibleFields = mergedFields.map((field) => {
            if (field.type === 'multiCollectionReference') {
                if (!('collectionId' in field) || typeof (field as { collectionId?: unknown }).collectionId !== 'string') {
                    return null;
                }
            }
            return field as ManagedCollectionFieldInput;
        }).filter((field): field is ManagedCollectionFieldInput => !!field && typeof field.id === 'string' && typeof field.name === 'string' && typeof field.type === 'string');
        const possibleSlugFields = [
            { id: '_id', name: 'Row ID', type: 'string' as const },
            ...dataSourceResult.dataSource.fields.filter((field: ManagedCollectionFieldInput) => field.type === "string")
        ]
        const slugField = possibleSlugFields.find(field => field.id === previousSlugFieldId)
        if (!slugField) {
            console.error(`No field matches the slug field id "${previousSlugFieldId}". Sync will not be performed.`)
            return { didSync: false }
        }
        await syncCollection(collection, dataSourceResult, [...compatibleFields], slugField)
        return { didSync: true }
    } catch (error) {
        console.error(error)
        console.error(`Failed to sync collection "${previousDataSourceId}". Check browser console for more details.`)
        return { didSync: false }
    }
}
