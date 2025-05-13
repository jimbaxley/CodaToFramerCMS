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
        case 'time': // Coda time-only (speculative type)
             return {
                id: column.id,
                name: column.name,
                type: 'string' // Framer string type
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
function transformCodaValue(value: any, field: ManagedCollectionFieldInput): FieldDataEntryInput {
    if (value === null || value === undefined) {
        // Return appropriate default value based on type
        // For date types, Framer might expect a valid date string or null.
        // Returning empty string for simplicity, but might need adjustment based on Framer's strictness.
        if (field.type === 'date') {
            // Framer's date field might prefer null or a specific empty state
            // For now, let's send an empty string, which might be ignored or cause issues.
            // A better approach might be to not set the field if value is null/undefined.
            return { type: 'string', value: '' } // Or handle as per Framer's expectation for empty dates
        }
        return { type: 'string', value: '' }
    }

    // For select/scale fields from Coda, extract the display name
    if (typeof value === 'object' && value !== null) {
        if ('name' in value) {
            return { type: 'string', value: String(value.name) }
        }
        if ('display' in value) {
            return { type: 'string', value: String(value.display) }
        }
    }

    // Handle all other types
    switch (field.type) {
        case 'number':
            return { type: 'number', value: Number(value) }
        case 'boolean':
            return { type: 'boolean', value: Boolean(value) }
        case 'date': // Covers Coda 'date' and 'datetime' mapped to Framer 'date'
            // Ensure the value is a valid date string or can be parsed into one.
            // Coda likely provides ISO strings or similar standard formats.
            try {
                return { type: 'date', value: new Date(value).toISOString() }
            } catch (e) {
                console.warn(`Invalid date value encountered for field ${field.name}: ${value}. Falling back to empty string.`);
                return { type: 'string', value: '' } // Fallback for invalid date values
            }
        case 'image':
        case 'file': {
            const urlStr = String(value);
            try {
                // Try to construct URL to validate it
                new URL(urlStr);
                return { type: field.type, value: urlStr }
            } catch (e) {
                // If URL is invalid, check if it's a relative path and make it absolute
                if (urlStr.startsWith('/')) {
                    return { type: field.type, value: `https://coda.io${urlStr}` }
                }
                // If all else fails, return empty string to prevent invalid URL errors
                console.warn(`Invalid URL found for ${field.type} field: ${urlStr}`);
                return { type: field.type, value: '' }
            }
        }
        case 'formattedText':
            return { type: 'formattedText', value: String(value) }
        case 'collectionReference':
            if (Array.isArray(value)) {
                return { 
                    type: 'collectionReference',
                    value: value[0]?.id || ''
                }
            }
            return { 
                type: 'collectionReference',
                value: typeof value === 'object' ? value.id || '' : String(value)
            }
        case 'link': {
            const urlStr = String(value);
            try {
                // Validate URL
                new URL(urlStr);
                return { type: 'link', value: urlStr }
            } catch (e) {
                // If URL is invalid, return empty string to prevent errors
                console.warn(`Invalid URL found for link field: ${urlStr}`);
                return { type: 'link', value: '' }
            }
        }
        default:
            return { type: 'string', value: String(value) }
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
                fieldData[key] = transformCodaValue(value, field)
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
            framer.notify(`No field matches the slug field id "${previousSlugFieldId}". Sync will not be performed.`, {
                variant: "error",
            })
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
                }
            }
            return field
        }) as ManagedCollectionFieldInput[]

        await syncCollection(collection, dataSource, transformedFields, slugField)
        return { didSync: true }
    } catch (error) {
        console.error(error)
        framer.notify(`Failed to sync collection "${previousDataSourceId}". Check browser console for more details.`, {
            variant: "error",
        })
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
