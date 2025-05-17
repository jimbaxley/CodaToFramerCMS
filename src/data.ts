import {
    type ManagedCollectionFieldInput,
    type FieldDataEntryInput,
    framer,
    type ManagedCollection,
    type ManagedCollectionItemInput,
    type EnumCaseDataInput
} from "framer-plugin"
import { type CodaColumn, type CodaDoc, type CodaTable, type DataSource, type GetDataSourceResult, type EnumCase } from "./types"
import { marked } from "marked";
import DOMPurify from "dompurify";

export const PLUGIN_KEYS = {
    DATA_SOURCE_ID: "dataSourceId",
    SLUG_FIELD_ID: "slugFieldId",
} as const

export interface DataSource {
    id: string
    name?: string
    fields: readonly ManagedCollectionFieldInput[]
    items: Record<string, FieldDataEntryInput>[]
}

export interface GetDataSourceResult {
    dataSource: DataSource;
    showImageUrlWarning: boolean;
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
        options?: {
            choices?: Array<{
                name: string;
                id?: string;
            }>;
        };
    };
}

// Helper: check if a string is a likely image URL (common extensions)
function isLikelyImageUrl(url: string): boolean {
    if (typeof url !== 'string') return false;
    const trimmed = url.trim();
    // Accepts .jpg, .jpeg, .png, .gif, .webp, .svg, .bmp, .tiff, .ico, .apng, .avif
    // OR any codahosted.io URL (with or without extension)
    return (
        /^https?:\/\/[^\s]+\.(jpe?g|png|gif|webp|svg|bmp|tiff?|ico|apng|avif)(\?.*)?$/i.test(trimmed) ||
        /^https?:\/\/codahosted\.io\//.test(trimmed)
    );
}

// Helper function to map Coda types to Framer types
function mapCodaTypeToFramerType(column: CodaColumn, _sampleValues: unknown[]): ManagedCollectionFieldInput {
    const baseType = column.format.type.toLowerCase();
    const name = column.name.toLowerCase();
    const id = column.id.toLowerCase();
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
    
    switch (baseType) {
        case 'select':
        case 'scale':
            // Handle select/scale fields as simple strings
            return {
                id: column.id,
                name: column.name,
                type: 'string'
            }
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
            // Log the column format to understand what metadata is available
            console.log(`Mapping ${baseType} field:`, {
                column,
                format: column.format
            });
            return {
                id: column.id,
                name: column.name,
                type: 'formattedText'
            }
        case 'person':
        case 'lookup':
        case 'reference':
            return {
                id: column.id,
                name: column.name,
                type: 'string' // Changed from 'collectionReference' to 'string'
            }
        case 'url':
        case 'link':
            return {
                id: column.id,
                name: column.name,
                type: 'link'
            }
        default:
            console.warn(`Unsupported Coda type "${baseType}", falling back to string`)
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
    // Use marked.parseSync if available, otherwise fallback to marked (sync)
    const rawHtml = (marked as any).parseSync ? (marked as any).parseSync(md) : marked(md);
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

function transformCodaValue(value: any, field: ManagedCollectionFieldInput, codaColumnType: string, use12HourTime?: boolean): FieldDataEntryInput | null {
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
                // Use 12/31/1999 as default since Framer requires a valid date
                return { type: 'date', value: '1999-12-31T00:00:00.000Z' }; 
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
            default:
                console.warn(`Unknown field type "${field.type}" for null/undefined/empty value. Defaulting to empty string.`);
                return { type: 'string', value: '' };
        }
    }

    // 2. Main switch on field.type (Framer type)
    switch (field.type) {
        case 'number':
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
                if (value['@type'] === 'MonetaryAmount' && typeof value.amount === 'number') {
                    numericValue = value.amount;
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
        case 'boolean':
            return { type: 'boolean', value: Boolean(value) };
        case 'date': 
            try {
                const dateObj = new Date(value);
                if (isNaN(dateObj.getTime())) {
                    console.warn(`Invalid date value encountered for field ${field.name}: ${value}. Using 12/31/1999 as fallback.`);
                    return { type: 'date', value: '1999-12-31T00:00:00.000Z' };
                }

                // Normalize dates to UTC midnight for date-only values, preserving local date
                if (codaColumnType === 'date' && value) {
                    // Extract date parts from the local timezone representation
                    const year = dateObj.getFullYear();
                    const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
                    const day = dateObj.getDate().toString().padStart(2, '0');
                    
                    // Create a new UTC date string at midnight
                    return { type: 'date', value: `${year}-${month}-${day}T00:00:00.000Z` };
                }
                
                // For 'datetime' type, convert to UTC while preserving the exact moment in time
                return value ? { type: 'date', value: dateObj.toISOString() } : { type: 'date', value: '1999-12-31T00:00:00.000Z' };
            } catch (e: any) {
                console.warn(`Error parsing date value for field ${field.name}: ${value} (Error: ${e.message}). Falling back to empty string.`);
                return { type: 'date', value: '' };
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
        case 'string':
            // Special handling for Coda text fields that may come as objects or arrays
            let textValue = '';

            // For debugging text fields only
            if (codaColumnType === 'text') {
                console.log(`[Text Processing] Field "${field.name}" metadata:`, {
                    valueType: typeof value,
                    isArray: Array.isArray(value),
                    hasRawValue: value && typeof value === 'object' && 'rawValue' in value,
                    hasValue: value && typeof value === 'object' && 'value' in value,
                });
            }

            // Handle arrays (including rawValue arrays)
            if (Array.isArray(value) || (value && typeof value === 'object' && Array.isArray((value as any).rawValue))) {
                const arr = Array.isArray(value) ? value : (value as any).rawValue;
                textValue = arr
                    .map((v: unknown) => {
                        if (typeof v === 'string') return v;
                        if (v && typeof v === 'object') {
                            // Try to extract the most meaningful text representation
                            const obj = v as Record<string, unknown>;
                            return (
                                (typeof obj.value === 'string' && obj.value) ||
                                (typeof obj.displayValue === 'string' && obj.displayValue) ||
                                (typeof obj.name === 'string' && obj.name) ||
                                String(v)
                            );
                        }
                        return String(v);
                    })
                    .filter(Boolean)
                    .join(', ');
            }
            // Handle object values
            else if (value && typeof value === 'object') {
                const obj = value as Record<string, unknown>;
                textValue = 
                    (typeof obj.value === 'string' && obj.value) ||
                    (typeof obj.displayValue === 'string' && obj.displayValue) ||
                    (typeof obj.name === 'string' && obj.name) ||
                    String(value);
            }
            // Handle simple values
            else {
                textValue = String(value);
            }

            return { type: 'string', value: stripMarkdown(textValue) };
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
                else if (value['@type'] === 'ImageObject') {
                    const urls = [value.url, value.contentUrl, value.thumbnailUrl].filter(u => typeof u === 'string');
                    for (const url of urls) {
                        if (isValidAssetUrl(url) || isLikelyImageUrl(url)) {
                            imageUrl = url;
                            break;
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

            // Log warning for invalid/missing URLs
            console.warn(`Invalid or missing image URL for field ${field.name}:`, { 
                rawValue: value,
                processedUrl: imageUrl || '(none)',
                validUrl: Boolean(imageUrl && isValidAssetUrl(imageUrl)),
                likelyImage: Boolean(imageUrl && isLikelyImageUrl(imageUrl))
            });
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
            console.warn(`Unsupported link value for field ${field.name}: ${JSON.stringify(value)}. Falling back to empty link URL.`);
            return { type: 'link', value: '' };
        }
        
        case 'collectionReference': { 
            let finalItemId = '';
            const processItem = (item: any): string | null => {
                if (typeof item === 'string') return item;
                if (typeof item === 'object' && item !== null) {
                    if ('id'in item && typeof item.id === 'string') return item.id;
                    if ('@id'in item && typeof item['@id'] === 'string') return item['@id'];
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

        default:
            console.warn(
                `Unhandled Framer field type "${field.type}" in transformCodaValue ` +
                `for Coda column type "${codaColumnType}" and value: ${JSON.stringify(value)}. ` +
                `Falling back to string representation.`
            );
            return { type: 'string', value: String(value) };
    }
}

// Utility to unwrap markdown code block/backtick formatting
function stripMarkdown(text: string): string {
    // Unwrap triple backticks if present
    const triple = text.match(/^```([\s\S]*?)```$/);
    if (triple && typeof triple[1] === 'string') return triple[1].trim();
    // Unwrap single backticks if present
    const single = text.match(/^`([^`]*)`$/);
    if (single && typeof single[1] === 'string') return single[1].trim();
    return text.trim();
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

    // First, fetch the columns metadata
    const columnsUrl = `https://coda.io/apis/v1/docs/${docId}/tables/${tableId}/columns`
    const columnsResponse = await fetch(columnsUrl, {
        ...(signal ? { signal } : {}),
        headers
    })

    if (!columnsResponse.ok) {
        throw new Error(`Failed to fetch data from Coda: ${columnsResponse.status}`)
    }

    const columnsData = await columnsResponse.json()

    const columns = columnsData.items
        .map((col: any) => ({
            id: col.id,
            name: String(col.name || col.id),
            format: col.format
        })) as CodaColumn[];

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

    const rowsData = await rowsResponse.json()

    // Add debug logging to see raw data structure
    console.log('Raw Coda API response:', {
        firstRow: rowsData.items[0],
        rowStructure: Object.keys(rowsData.items[0] || {})
    });

    const firstRow = rowsData.items[0]?.values || {};

    // Instead of using only the first row, gather all values for each column
    // But now, sampleValues is not used for image detection, so we can just pass an empty array or undefined
    const fields = columns.map((col: CodaColumn) => {
        // Only use type/name/id for mapping, not values
        const mappedField = mapCodaTypeToFramerType(col, []);
        if (mappedField.type === 'image' || mappedField.type === 'file') {
            hasImageOrFileFields = true;
        }
        return mappedField;
    });

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
            // Keep the existing field's name and ID
            return { 
                ...sourceField,
                id: existingField.id,
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
    fields: readonly ManagedCollectionFieldInput[],
    slugField: ManagedCollectionFieldInput
) {
    const { dataSource } = dataSourceResult;
    // Create a map of fields by ID for faster lookup
    const fieldMap = new Map(fields.map(field => [field.id, field]))

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
                // Use the field ID from our map to ensure consistency
                fieldData[field.id] = value as FieldDataEntryInput
            }
        }

        items.push({
            id: rowId,
            slug: slugValue,
            draft: false,
            fieldData,
        })
    }

    // Transform the fields to ensure proper typing for enum cases
    const transformedFields = fields.map(field => {
        if (field.type === "enum" && "cases" in field) {
            return {
                ...field,
                cases: (field.cases || []).map((caseData: EnumCaseDataInput, idx) => ({
                    id: caseData.id || `case-${idx}`,
                    name: caseData.name,
                    nameByLocale: {
                        en: {
                            action: "set" as const,
                            value: caseData.name,
                            needsReview: false
                        }
                    }
                }))
            }
        }
        return field
    })

    await collection.setFields(transformedFields)
    await collection.removeItems(Array.from(unsyncedItems))
    await collection.addItems(items)

    await collection.setPluginData(PLUGIN_KEYS.DATA_SOURCE_ID, dataSource.id)
    await collection.setPluginData(PLUGIN_KEYS.SLUG_FIELD_ID, slugField.id)
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
        const dataSourceResult = await getDataSource() // Will now return GetDataSourceResult
        const existingFields = await collection.getFields()

        // Create a list of possible slug fields including the special _id field
        const possibleSlugFields = [
            { id: '_id', name: 'Row ID', type: 'string' as const },
            ...dataSourceResult.dataSource.fields.filter(field => field.type === "string")
        ]
        
        const slugField = possibleSlugFields.find(field => field.id === previousSlugFieldId)
        if (!slugField) {
            console.error(`No field matches the slug field id "${previousSlugFieldId}". Sync will not be performed.`)
            return { didSync: false }
        }

        // Transform existing fields to ensure proper typing
        const transformedFields = existingFields.map(field => {
            if (field.type === "enum" && field.cases) {
                return {
                    ...field,
                    cases: field.cases.map((c: EnumCase, idx: number) => ({
                        id: c.id || `case-${idx}`,
                        name: c.name,
                        nameByLocale: Object.fromEntries(
                            Object.entries(c.nameByLocale || {}).map(([locale, value]) => [
                                locale,
                                {
                                    action: "set" as const,
                                    value: typeof value === 'string' ? value : String(value),
                                    needsReview: false
                                } satisfies LocalizedValueUpdate
                            ])
                        )
                    }))
                }; // Added missing closing brace
            }
            return field;
        }) as ManagedCollectionFieldInput[];

        await syncCollection(collection, dataSourceResult, transformedFields, slugField) // Pass dataSourceResult
        return { didSync: true }
    } catch (error) {
        console.error(error)
        console.error(`Failed to sync collection "${previousDataSourceId}". Check browser console for more details.`)
        return { didSync: false }
    }
}

export interface CodaDoc {
    id: string;
    name: string;
    type: string;
}

export interface CodaTable {
    id: string;
    name: string;
    type: string;
}

export async function getCodaDocs(
    apiKey: string,
    signal?: AbortSignal
): Promise<CodaDoc[]> {
    const docsUrl = `https://coda.io/apis/v1/docs`
    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
    }
    
    const docsResponse = await fetch(docsUrl, {
        ...(signal ? { signal } : {}),
        headers,
    })

    if (!docsResponse.ok) {
        const errorText = await docsResponse.text()
        throw new Error(`Failed to fetch docs from Coda: ${docsResponse.status} ${errorText}`)
    }

    const docsData = await docsResponse.json()
    return docsData.items
        .filter((doc: any) => doc.type === 'doc')
        .map((doc: any) => ({
            id: doc.id,
            name: doc.name,
            type: doc.type
        }))
}

export async function getCodaTables(
    apiKey: string,
    docId: string,
    signal?: AbortSignal
): Promise<CodaTable[]> {
    const tablesUrl = `https://coda.io/apis/v1/docs/${docId}/tables`
    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
    }
    
    const tablesResponse = await fetch(tablesUrl, {
        ...(signal ? { signal } : {}),
        headers,
    })

    if (!tablesResponse.ok) {
        const errorText = await tablesResponse.text()
        throw new Error(`Failed to fetch tables from Coda: ${tablesResponse.status} ${errorText}`)
    }

    const tablesData = await tablesResponse.json()
    return tablesData.items.map((table: any) => ({
        id: table.id,
        name: table.name,
        type: table.type
    }))
}
