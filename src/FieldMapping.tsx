import { type ManagedCollectionFieldInput, type LocalizedValueUpdate, type EnumCaseData, framer, type ManagedCollection } from "framer-plugin"
import { useEffect, useState } from "react"
import { type DataSource, mergeFieldsWithExistingFields, syncCollection } from "./data"

interface FieldMappingRowProps {
    field: ManagedCollectionFieldInput
    originalFieldName: string | undefined
    disabled: boolean
    onToggleDisabled: (fieldId: string) => void
    onNameChange: (fieldId: string, name: string) => void
}

function FieldMappingRow({ field, originalFieldName, disabled, onToggleDisabled, onNameChange }: FieldMappingRowProps) {
    return (
        <>
            <button
                type="button"
                className="source-field"
                aria-disabled={disabled}
                onClick={() => onToggleDisabled(field.id)}
                tabIndex={0}
            >
                <input type="checkbox" checked={!disabled} tabIndex={-1} readOnly />
                <span>{originalFieldName ?? field.id} ({field.id})</span>
            </button>
            <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" fill="none">
                <path
                    fill="transparent"
                    stroke="#999"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="1.5"
                    d="m2.5 7 3-3-3-3"
                />
            </svg>
            <input
                type="text"
                style={{ width: "100%", opacity: disabled ? 0.5 : 1 }}
                disabled={disabled}
                placeholder={field.id}
                value={field.name}
                onChange={event => onNameChange(field.id, event.target.value)}
                onKeyDown={event => {
                    if (event.key === "Enter") {
                        event.preventDefault()
                    }
                }}
            />
        </>
    )
}

const initialManagedCollectionFields: ManagedCollectionFieldInput[] = []
const initialFieldIds: ReadonlySet<string> = new Set()

interface FieldMappingProps {
    collection: ManagedCollection
    dataSource: DataSource
    initialSlugFieldId: string | null
}

export function FieldMapping({ collection, dataSource, initialSlugFieldId }: FieldMappingProps) {
    const [status, setStatus] = useState<"mapping-fields" | "loading-fields" | "syncing-collection">(
        initialSlugFieldId ? "loading-fields" : "mapping-fields"
    )
    const isSyncing = status === "syncing-collection"
    const isLoadingFields = status === "loading-fields"

    const [possibleSlugFields] = useState(() => [
        // Add row ID as the first (default) option
        { id: '_id', name: 'Row ID', type: 'string' as const },
        ...dataSource.fields.filter(field => field.type === "string")
    ] as ManagedCollectionFieldInput[])

    const [selectedSlugField, setSelectedSlugField] = useState<ManagedCollectionFieldInput | null>(
        possibleSlugFields.find(field => field.id === initialSlugFieldId) ?? possibleSlugFields[0] ?? null
    )

    const [fields, setFields] = useState(initialManagedCollectionFields)
    const [ignoredFieldIds, setIgnoredFieldIds] = useState(initialFieldIds)

    // Use the dataSource id directly since it's the table name from Coda
    const dataSourceName = dataSource.id

    useEffect(() => {
        const abortController = new AbortController()

        collection
            .getFields()
            .then(collectionFields => {
                if (abortController.signal.aborted) return

                setFields(
                    mergeFieldsWithExistingFields(
                        dataSource.fields,
                        collectionFields.map(field => {
                            if (field.type === "enum" && field.cases) {
                                return {
                                    ...field,
                                    cases: field.cases.map(c => ({
                                        ...c,
                                        nameByLocale: c.nameByLocale ?? {}
                                    }))
                                }
                            }
                            return field
                        })
                    )
                )

                const existingFieldIds = new Set(collectionFields.map(field => field.id))
                const ignoredFields = dataSource.fields.filter(sourceField => !existingFieldIds.has(sourceField.id))

                if (initialSlugFieldId) {
                    setIgnoredFieldIds(new Set(ignoredFields.map(field => field.id)))
                }

                setStatus("mapping-fields")
            })
            .catch(error => {
                if (!abortController.signal.aborted) {
                    console.error("Failed to fetch collection fields:", error)
                    framer.notify("Failed to load collection fields", { variant: "error" })
                }
            })

        return () => {
            abortController.abort()
        }
    }, [initialSlugFieldId, dataSource, collection])

    const changeFieldName = (fieldId: string, name: string) => {
        setFields(prevFields => {
            const updatedFields = prevFields.map(field => {
                if (field.id !== fieldId) return field
                return { ...field, name }
            })
            return updatedFields as ManagedCollectionFieldInput[]
        })
    }

    const toggleFieldDisabledState = (fieldId: string) => {
        setIgnoredFieldIds(previousIgnoredFieldIds => {
            const updatedIgnoredFieldIds = new Set(previousIgnoredFieldIds)

            if (updatedIgnoredFieldIds.has(fieldId)) {
                updatedIgnoredFieldIds.delete(fieldId)
            } else {
                updatedIgnoredFieldIds.add(fieldId)
            }

            return updatedIgnoredFieldIds
        })
    }

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault()

        if (!selectedSlugField) {
            framer.notify("Please select a slug field before importing.", { variant: "warning" })
            return
        }

        try {
            setStatus("syncing-collection")

            const sanitizedFields = fields.map(field => {
                const sanitizedField = {
                    ...field,
                    name: field.name.trim() || field.id,
                }

                if (field.type === "enum" && "cases" in field) {
                    return {
                        ...sanitizedField,
                        cases: (field.cases || []).map((caseData: EnumCaseData, idx: number) => ({
                            id: caseData.id || `case-${idx}`,
                            name: caseData.name,
                            nameByLocale: caseData.nameByLocale ?? {}
                        }))
                    }
                }

                return sanitizedField
            })

            const fieldsToSync = sanitizedFields.filter(field => !ignoredFieldIds.has(field.id)) as ManagedCollectionFieldInput[]

            await syncCollection(collection, dataSource, fieldsToSync, selectedSlugField)
            await framer.closePlugin("Synchronization successful", { variant: "success" })
        } catch (error) {
            console.error(error)
            framer.notify(`Failed to sync collection "${dataSource.id}". Check the logs for more details.`, {
                variant: "error",
            })
        } finally {
            setStatus("mapping-fields")
        }
    }

    if (isLoadingFields) {
        return (
            <main className="loading">
                <div className="framer-spinner" />
            </main>
        )
    }

    return (
        <main className="framer-hide-scrollbar mapping">
            <hr className="sticky-divider" />
            <form onSubmit={handleSubmit}>
                <label className="slug-field" htmlFor="slugField">
                    Slug Field
                    <select
                        required
                        name="slugField"
                        className="field-input"
                        value={selectedSlugField ? selectedSlugField.id : ""}
                        onChange={event => {
                            const selectedFieldId = event.target.value
                            const selectedField = possibleSlugFields.find(field => field.id === selectedFieldId)
                            if (!selectedField) return
                            setSelectedSlugField(selectedField)
                        }}
                    >
                        {possibleSlugFields.map(possibleSlugField => {
                            return (
                                <option key={`slug-field-${possibleSlugField.id}`} value={possibleSlugField.id}>
                                    {possibleSlugField.name} ({possibleSlugField.id})
                                </option>
                            )
                        })}
                    </select>
                </label>

                <div className="fields">
                    <span className="fields-column">Column</span>
                    <span>Field</span>
                    {fields.map(field => (
                        <FieldMappingRow
                            key={`field-${field.id}`}
                            field={field}
                            originalFieldName={dataSource.fields.find(sourceField => sourceField.id === field.id)?.name}
                            disabled={ignoredFieldIds.has(field.id)}
                            onToggleDisabled={toggleFieldDisabledState}
                            onNameChange={changeFieldName}
                        />
                    ))}
                </div>

                <footer>
                    <hr className="sticky-top" />
                    <button disabled={isSyncing} tabIndex={0}>
                        {isSyncing ? (
                            <div className="framer-spinner" />
                        ) : (
                            <span>
                                Import <span style={{ textTransform: "capitalize" }}>{dataSourceName}</span>
                            </span>
                        )}
                    </button>
                </footer>
            </form>
        </main>
    )
}
