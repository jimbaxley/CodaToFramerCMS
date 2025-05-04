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

export const dataSourceOptions = [
    { id: "articles", name: "Articles" },
    { id: "categories", name: "Categories" },
] as const

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
export async function getDataSource(dataSourceId: string, abortSignal?: AbortSignal): Promise<DataSource> {
    // Fetch from your data source
    const dataSourceResponse = await fetch(`/data/${dataSourceId}.json`, { signal: abortSignal })
    const dataSource = await dataSourceResponse.json()

    // Map your source fields to supported field types in Framer
    const fields: ManagedCollectionFieldInput[] = []
    for (const field of dataSource.fields) {
        switch (field.type) {
            case "string":
            case "number":
            case "boolean":
            case "color":
            case "formattedText":
            case "date":
            case "link":
                fields.push({
                    id: field.name,
                    name: field.name,
                    type: field.type,
                })
                break
            case "image":
            case "file":
            case "enum":
            case "collectionReference":
            case "multiCollectionReference":
                console.warn(`Support for field type "${field.type}" is not implemented in this Plugin.`)
                break
            default: {
                console.warn(`Unknown field type "${field.type}".`)
            }
        }
    }

    const items = dataSource.items as Record<string, FieldDataEntryInput>[]

    return {
        id: dataSource.id,
        fields,
        items,
    }
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
        case 'date':
        case 'datetime':
            return {
                id: column.id,
                name: column.name,
                type: 'date'
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
        case 'date':
            return { type: 'date', value: new Date(value).toISOString() }
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
    abortSignal?: AbortSignal
): Promise<DataSource> {
    const headers = {
        'Authorization': `Bearer ${encodeURIComponent(apiKey)}`,
        'Content-Type': 'application/json'
    }

    // First, fetch the columns metadata
    const columnsUrl = `https://coda.io/apis/v1/docs/${docId}/tables/${tableId}/columns`
    const columnsResponse = await fetch(columnsUrl, {
        signal: abortSignal,
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
        signal: abortSignal,
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
                    nameByLocale: Object.fromEntries(
                        Object.entries(caseData.nameByLocale || {}).map(([locale, value]) => [
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
        const dataSource = await getDataSource(previousDataSourceId)
        const existingFields = await collection.getFields()

        const slugField = dataSource.fields.find(field => field.id === previousSlugFieldId)
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
    abortSignal?: AbortSignal
): Promise<CodaDoc[]> {
    const docsUrl = `https://coda.io/apis/v1/docs`
    const headers = {
        'Authorization': `Bearer ${encodeURIComponent(apiKey)}`,
        'Content-Type': 'application/json'
    }
    
    const docsResponse = await fetch(docsUrl, {
        signal: abortSignal,
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
    abortSignal?: AbortSignal
): Promise<CodaTable[]> {
    const tablesUrl = `https://coda.io/apis/v1/docs/${docId}/tables`
    const headers = {
        'Authorization': `Bearer ${encodeURIComponent(apiKey)}`,
        'Content-Type': 'application/json'
    }
    
    const tablesResponse = await fetch(tablesUrl, {
        signal: abortSignal,
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
