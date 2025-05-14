import {
    type ManagedCollectionFieldInput,
    type FieldDataEntryInput,
    type LocalizedValueUpdate,
    type EnumCaseData,
    framer,
    type ManagedCollection,
    type ManagedCollectionItemInput,
} from "framer-plugin"

export const PLUGIN_KEYS = {
    DATA_SOURCE_ID: "dataSourceId",
    SLUG_FIELD_ID: "slugFieldId",
} as const

export interface DataSource {
    id: string
    fields: readonly ManagedCollectionFieldInput[]
    items: Record<string, FieldDataEntryInput>[]
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
export async function getDataSource(abortSignal?: AbortSignal): Promise<DataSource> {
    // Get existing Coda settings from plugin data
    const collection = await framer.getActiveManagedCollection();
    const [apiKey, docId, tableId] = await Promise.all([
        collection.getPluginData('apiKey'),
        collection.getPluginData('docId'),
        collection.getPluginData('tableId')
    ]);
    
    if (!apiKey || !docId || !tableId) {
        throw new Error('Missing Coda configuration. Please configure the plugin first.')
    }

    // Use the existing getCodaDataSource function to fetch data
    return getCodaDataSource(apiKey, docId, tableId, abortSignal);
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

// Helper function to map Coda types to Framer types
function mapCodaTypeToFramerType(column: CodaColumn): ManagedCollectionFieldInput {
    const baseType = column.format.type.toLowerCase()
    
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
                type: 'collectionReference',
                collectionId: column.id // Using column ID as collection ID since Coda doesn't provide direct mapping
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
function transformCodaValue(value: any, field: ManagedCollectionFieldInput, codaColumnType: string, use12HourTime?: boolean): FieldDataEntryInput {
    // 1. Handle null/undefined based on Framer field.type
    if (value === null || value === undefined) {
        switch (field.type) {
            case 'string':
                return { type: 'string', value: '' };
            case 'number':
                return { type: 'number', value: 0 }; 
            case 'boolean':
                return { type: 'boolean', value: false };
            case 'date':
                return { type: 'date', value: '' }; 
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
                console.warn(`Unknown field type "${field.type}" for null/undefined value. Defaulting to empty string.`);
                return { type: 'string', value: '' };
        }
    }

    // 2. Main switch on field.type (Framer type)
    switch (field.type) {
        case 'number':
            const num = Number(value);
            return { type: 'number', value: isNaN(num) ? 0 : num };
        case 'boolean':
            return { type: 'boolean', value: Boolean(value) };
        case 'date': 
            try {
                const dateObj = new Date(value);
                if (isNaN(dateObj.getTime())) {
                    console.warn(`Invalid date value encountered for field ${field.name}: ${value}. Falling back to empty string.`);
                    return { type: 'date', value: '' };
                }
                if (codaColumnType === 'date') { 
                    const year = dateObj.getUTCFullYear();
                    const month = (dateObj.getUTCMonth() + 1).toString().padStart(2, '0');
                    const day = dateObj.getUTCDate().toString().padStart(2, '0');
                    return { type: 'date', value: `${year}-${month}-${day}T00:00:00.000Z` };
                }
                return { type: 'date', value: dateObj.toISOString() };
            } catch (e: any) {
                console.warn(`Error parsing date value for field ${field.name}: ${value} (Error: ${e.message}). Falling back to empty string.`);
                return { type: 'date', value: '' };
            }
        case 'string': 
            if (codaColumnType === 'time') { 
                try {
                    const dateObj = new Date(value); // Coda sends time as a full datetime string
                    if (isNaN(dateObj.getTime())) {
                        console.warn(`Invalid time value encountered for field ${field.name}: ${value}. Falling back to empty string.`);
                        return { type: 'string', value: '' };
                    }
                    
                    const hours24 = dateObj.getUTCHours();
                    const minutes = dateObj.getUTCMinutes();
                    const seconds = dateObj.getUTCSeconds();

                    if (use12HourTime) {
                        const ampm = hours24 >= 12 ? 'PM' : 'AM';
                        let hours12 = hours24 % 12;
                        hours12 = hours12 ? hours12 : 12; // Convert 0 (midnight) to 12, and 12 (noon) to 12
                        
                        const stringHours12 = hours12.toString(); // e.g., "1", "12"
                        const paddedMinutes = minutes.toString().padStart(2, '0');
                        // Omitting seconds for typical 12-hour display, add if needed:
                        // const paddedSeconds = seconds.toString().padStart(2, '0');
                        // return { type: 'string', value: `${stringHours12}:${paddedMinutes}:${paddedSeconds} ${ampm}` };
                        return { type: 'string', value: `${stringHours12}:${paddedMinutes} ${ampm}` };
                    } else {
                        // Default to 24-hour format with seconds
                        const paddedHours24 = hours24.toString().padStart(2, '0');
                        const paddedMinutes = minutes.toString().padStart(2, '0');
                        const paddedSeconds = seconds.toString().padStart(2, '0');
                        return { type: 'string', value: `${paddedHours24}:${paddedMinutes}:${paddedSeconds}` };
                    }
                } catch (e: any) {
                    console.warn(`Error parsing time value for field ${field.name}: ${value} (Error: ${e.message}). Falling back to empty string.`);
                    return { type: 'string', value: '' };
                }
            }
            if (typeof value === 'object' && value !== null) {
                if ('name' in value && typeof value.name === 'string') {
                    return { type: 'string', value: value.name };
                }
                if ('display' in value && typeof value.display === 'string') { 
                    return { type: 'string', value: value.display };
                }
                try {
                    return { type: 'string', value: JSON.stringify(value) };
                } catch (e) {
                    return { type: 'string', value: '[unstringifiable object]' };
                }
            }
            return { type: 'string', value: String(value) };

        case 'image': { 
            let imageUrl = '';
            if (typeof value === 'string') {
                imageUrl = value;
            } else if (typeof value === 'object' && value !== null) {
                if ('url' in value && typeof value.url === 'string') {
                    imageUrl = value.url;
                } else if ('link' in value && typeof value.link === 'string') { 
                    imageUrl = value.link;
                }
            }
            if (imageUrl) {
                if (imageUrl.startsWith('/') && !imageUrl.startsWith('//')) {
                    console.warn(`Potentially relative image URL found for ${field.name}: ${imageUrl}.`);
                }
                return { type: 'image', value: imageUrl }; 
            }
            console.warn(`Unsupported image value for field ${field.name}: ${JSON.stringify(value)}. Falling back to empty image URL.`);
            return { type: 'image', value: '' };
        }

        case 'file': { 
            let fileUrl = '';
            if (typeof value === 'string') { 
                fileUrl = value;
            } else if (typeof value === 'object' && value !== null) {
                if ('url' in value && typeof value.url === 'string') {
                    fileUrl = value.url;
                } else if ('link' in value && typeof value.link === 'string') { 
                    fileUrl = value.link;
                }
            }
            if (fileUrl) {
                 if (fileUrl.startsWith('/') && !fileUrl.startsWith('//')) {
                     console.warn(`Potentially relative file URL found for ${field.name}: ${fileUrl}.`);
                }
                return { type: 'file', value: fileUrl }; 
            }
            console.warn(`Unsupported file value for field ${field.name}: ${JSON.stringify(value)}. Falling back to empty file URL.`);
            return { type: 'file', value: '' };
        }

        case 'formattedText': 
            return { type: 'formattedText', value: String(value) };

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

export async function getCodaDataSource(
    apiKey: string,
    docId: string,
    tableId: string,
    signal?: AbortSignal
): Promise<DataSource> {
    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
    }

    // First, fetch the columns metadata
    const columnsUrl = `https://coda.io/apis/v1/docs/${docId}/tables/${tableId}/columns`
    const columnsResponse = await fetch(columnsUrl, {
        ...(signal ? { signal } : {}),
        headers,
    })

    if (!columnsResponse.ok) {
        const errorText = await columnsResponse.text()
        throw new Error(`Failed to fetch columns from Coda: ${columnsResponse.status} ${errorText}`)
    }

    const columnsData = await columnsResponse.json()
    const columns: CodaColumn[] = columnsData.items
        .filter((col: CodaColumn) => col.display !== false)
        .map((col: CodaColumn) => ({
            id: col.id,
            name: String(col.name || col.id),
            format: col.format
        }))

    // Map columns to Framer fields with proper types and enum cases
    const fields = columns.map(col => mapCodaTypeToFramerType(col))
    const fieldMap = new Map<string, ManagedCollectionFieldInput>(
        fields.map((field: ManagedCollectionFieldInput) => [field.id, field])
    )
    // Store original Coda column types
    const codaColumnTypeMap = new Map<string, string>(
        columns.map(col => [col.id, col.format.type.toLowerCase()])
    )

    // TODO: In a future step, retrieve user preference for 12-hour time format here.
    // For example: const use12HourTimePreference = await framer.getPluginData("use12HourTimeFormat") === "true";
    const use12HourTimePreferenceRaw = await framer.getPluginData("use12HourTimeFormat");
    const use12HourTimePreference = use12HourTimePreferenceRaw === "true";

    // Then fetch the rows
    const rowsUrl = `https://coda.io/apis/v1/docs/${docId}/tables/${tableId}/rows`
    const rowsResponse = await fetch(rowsUrl, {
        ...(signal ? { signal } : {}),
        headers,
    })

    if (!rowsResponse.ok) {
        const errorText = await rowsResponse.text()
        throw new Error(`Failed to fetch data from Coda: ${rowsResponse.status} ${errorText}`)
    }

    const rowsData = await rowsResponse.json()

    const items = rowsData.items.map((row: { id: string; values: Record<string, unknown> }) => {
        const fieldData: Record<string, FieldDataEntryInput> = {
            // Add the row ID as a special field
            _id: {
                type: "string",
                value: row.id
            }
        }

        for (const [key, value] of Object.entries(row.values)) {
            // Only include fields that are in our field map
            const field = fieldMap.get(key)
            if (field) {
                const codaType = codaColumnTypeMap.get(key) || 'text'; // Default to text if not found
                // Pass the preference to transformCodaValue
                fieldData[key] = transformCodaValue(value, field, codaType, use12HourTimePreference)
            }
        }
        
        return fieldData
    })

    return {
        id: tableId,
        fields,
        items,
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
    dataSource: DataSource,
    fields: readonly ManagedCollectionFieldInput[],
    slugField: ManagedCollectionFieldInput
) {
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

    const transformedFields = fields.map(field => {
        if (field.type === "enum") {
            return {
                ...field,
                cases: (field.cases || []).map((caseData: EnumCaseData, idx: number) => ({
                    id: caseData.id || `case-${idx}`,
                    name: caseData.name,
                    nameByLocale: caseData.nameByLocale ?? {}
                }))
            }
        }
        return field
    }) as ManagedCollectionFieldInput[]

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
        const dataSource = await getDataSource()
        const existingFields = await collection.getFields()

        // Create a list of possible slug fields including the special _id field
        const possibleSlugFields = [
            { id: '_id', name: 'Row ID', type: 'string' as const },
            ...dataSource.fields.filter(field => field.type === "string")
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
                    cases: field.cases.map((c: EnumCaseData, idx: number) => ({
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

        await syncCollection(collection, dataSource, transformedFields, slugField)
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
