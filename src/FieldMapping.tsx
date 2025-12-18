import { type ManagedCollectionFieldInput, framer, type ManagedCollection } from "framer-plugin"
import { useEffect, useState } from "react"
import { type GetDataSourceResult, mergeFieldsWithExistingFields, syncCollection } from "./data"

interface FieldMappingRowProps {
    field: ManagedCollectionFieldInput
    originalFieldName: string | undefined
    isIgnored: boolean // Changed from 'disabled'
    onToggleDisabled: (fieldId: string) => void
    onNameChange: (fieldId: string, name: string) => void
}

function FieldMappingRow({ field, originalFieldName, isIgnored, onToggleDisabled, onNameChange }: FieldMappingRowProps) {
    return (
        <>
            <button
                type="button"
                className="source-field"
                aria-disabled={isIgnored || undefined}
                onClick={() => onToggleDisabled(field.id)}
                tabIndex={0}
                data-field-type={field.type}
            >
                <input 
                    type="checkbox" 
                    checked={!isIgnored} 
                    tabIndex={-1} 
                    readOnly 
                />
                <span>
                    {originalFieldName ?? field.id}
                    {field.type === 'enum' && <span style={{ marginLeft: '4px', fontSize: '0.85em', color: '#999' }}>(Enum)</span>}
                </span>
            </button>
            <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" fill="none">
                <path
                    fill="transparent"
                    stroke="#999"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.5"
                    d="m2.5 7 3-3-3-3"
                />
            </svg>
            <input
                type="text"
                style={{ 
                    width: "100%", 
                    opacity: isIgnored ? 0.5 : 1 
                }}
                disabled={isIgnored}
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
    dataSourceResult: GetDataSourceResult
    initialSlugFieldId: string | null
    onBack: () => void
}

export function FieldMapping({ collection, dataSourceResult, initialSlugFieldId, onBack }: FieldMappingProps) {
    const { dataSource } = dataSourceResult;

    const [status, setStatus] = useState<"mapping-fields" | "loading-fields" | "syncing-collection">(
        initialSlugFieldId ? "loading-fields" : "mapping-fields"
    )
    const isSyncing = status === "syncing-collection"
    const isLoadingFields = status === "loading-fields"

    // Always use Row ID as default, since it's guaranteed to be unique
    const stringFields = dataSource.fields.filter(field => field.type === "string")
    const defaultSlugField = { id: '_id', name: 'Row ID', type: 'string' as const }

    const [possibleSlugFields] = useState(() => [
        { id: '_id', name: 'Row ID', type: 'string' as const },
        ...stringFields
    ] as ManagedCollectionFieldInput[])

    const [selectedSlugField, setSelectedSlugField] = useState<ManagedCollectionFieldInput | null>(
        possibleSlugFields.find(field => field.id === initialSlugFieldId) ?? defaultSlugField
    )

    const [fields, setFields] = useState(initialManagedCollectionFields)
    const [ignoredFieldIds, setIgnoredFieldIds] = useState(initialFieldIds)
    const [use12HourTimeFormat, setUse12HourTimeFormat] = useState(false) // New state for time format

    useEffect(() => {
        const abortController = new AbortController()

        // Load time format preference
        framer.getPluginData("use12HourTimeFormat").then(storedPreference => {
            if (!abortController.signal.aborted) {
                setUse12HourTimeFormat(storedPreference === "true")
            }
        })

        collection
            .getFields()
            .then(collectionFields => {
                if (abortController.signal.aborted) return

                // Preserve all field types including enums
                const compatibleFields = collectionFields.map(field => {
                    return { ...field } as ManagedCollectionFieldInput
                })

                const mergedSourceFields = mergeFieldsWithExistingFields(
                    dataSource.fields,
                    compatibleFields
                );
                setFields(mergedSourceFields);

                const existingFieldIds = new Set(collectionFields.map(field => field.id))
                const initialIgnored = new Set<string>()
                
                mergedSourceFields.forEach(sourceField => {
                    // Removed: sourceField.type === "image" check for auto-ignoring
                    // Image fields now follow the same logic as other fields:
                    // Ignore if it's a new field and we're editing (initialSlugFieldId exists)
                    const isExistingField = existingFieldIds.has(sourceField.id);
                    if (!isExistingField && initialSlugFieldId) {
                        initialIgnored.add(sourceField.id);
                    }
                });
                setIgnoredFieldIds(initialIgnored);
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
    }, [initialSlugFieldId, dataSource, collection]) // dataSource dependency remains as it's from dataSourceResult

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
        // const field = fields.find(f => f.id === fieldId); // No longer needed
        // if (field && field.type === "image") { // Removed: Allow toggling for all field types
        //     return; 
        // }

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
                        cases: (field.cases || []).map((caseData, idx) => {
                            const enumCase = {
                                id: caseData.id || `case-${idx}`,
                                name: caseData.name,
                                nameByLocale: {
                                    en: {
                                        action: "set" as const,
                                        value: caseData.name,
                                        needsReview: false
                                    }
                                }
                            }
                            return enumCase
                        })
                    }
                }

                return sanitizedField
            })

            const fieldsToSync = sanitizedFields.filter(field => !ignoredFieldIds.has(field.id))
            await syncCollection(collection, dataSourceResult, fieldsToSync, selectedSlugField)
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

    const handleTimeFormatChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const isChecked = event.target.checked
        setUse12HourTimeFormat(isChecked)
        await framer.setPluginData("use12HourTimeFormat", isChecked ? "true" : "false")
        framer.notify(`Time format set to ${isChecked ? "12-hour" : "24-hour"}. You may need to re-sync for changes to apply to existing data.`, { variant: "success" })
    }

    // State for Select All toggle
    const [allSelected, setAllSelected] = useState(true)

    // Effect to update Select All checkbox based on field selection state
    useEffect(() => {
        if (fields.length > 0) {
            const allFieldsSelected = fields.every(f => !ignoredFieldIds.has(f.id));
            setAllSelected(allFieldsSelected);
        }
    }, [fields, ignoredFieldIds]);
    
    // Handler for Select All checkbox
    const handleSelectAllCheckbox = (event: React.ChangeEvent<HTMLInputElement>) => {
        const checked = event.target.checked;
        
        if (checked) {
            // Select all fields by clearing the ignored set
            setIgnoredFieldIds(new Set());
        } else {
            // Deselect all fields by adding all field IDs to ignored set
            const allFieldIds = new Set(fields.map(f => f.id));
            setIgnoredFieldIds(allFieldIds);
        }
    }

    useEffect(() => {
        const handle = (event: KeyboardEvent) => {
            if (event.key === "Enter") {
                event.preventDefault()
                const target = event.target as HTMLElement
                const checkbox = target.closest("label")?.querySelector("input[type='checkbox']")
                if (checkbox && checkbox instanceof HTMLElement) {
                    checkbox.click()
                }
            }
        }

        document.addEventListener("keydown", handle)
        return () => {
            document.removeEventListener("keydown", handle)
        }
    }, [])

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
            {/* The form now acts as the step-form-wrapper */}
            <form onSubmit={handleSubmit} className="step-form-wrapper">
                {/* Content area for slug field and fields list */}
                <div className="content-scrollable-area">
                    {/* Add Time Format Preference Checkbox at the top */}
                    <div className="time-format-preference" style={{ marginTop: 0, marginBottom: "10px", padding: "10px", border: "1px solid #eee", borderRadius: "4px" }}>
                        <label htmlFor="timeFormatCheckbox" style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
                            <input
                                type="checkbox"
                                id="timeFormatCheckbox"
                                checked={use12HourTimeFormat}
                                onChange={handleTimeFormatChange}
                                style={{ marginRight: "8px" }}
                            />
                            Use 12-hour time format (e.g., 1:30 PM)
                        </label>
                        <p style={{ fontSize: "0.9em", color: "#666", marginTop: "5px" }}>
                            If unchecked, 24-hour format (e.g., 13:30:00) will be used for time fields.
                        </p>
                    </div>

                    <label className="slug-field" htmlFor="slugField">
                        Slug Field (must be a unique value)
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
                                        {possibleSlugField.name}
                                    </option>
                                )
                            })}
                        </select>
                    </label>

                    {/* Select All Toggle Button */}
                    <label style={{ display: 'flex', alignItems: 'center', margin: '16px 0 8px 0', fontWeight: 500 }}>
                        <input
                            type="checkbox"
                            checked={allSelected}
                            onChange={handleSelectAllCheckbox}
                            style={{ marginRight: 8 }}
                        />
                        Select All Fields
                    </label>

                    <div className="fields">
                        <span className="fields-column">Column</span>
                        <span>Field</span>
                        {fields.map(field => ( // Removed filter: field.type !== "image"
                            <FieldMappingRow
                                key={`field-${field.id}`}
                                field={field}
                                originalFieldName={dataSource.fields.find(sourceField => sourceField.id === field.id)?.name}
                                isIgnored={ignoredFieldIds.has(field.id)} // Pass isIgnored
                                onToggleDisabled={toggleFieldDisabledState}
                                onNameChange={changeFieldName}
                            />
                        ))}
                    </div>
                </div> {/* End of content-scrollable-area */}

                <footer>
                    <hr className="sticky-top" />
                    <p >
                            Need help?<br></br> See <a href="https://github.com/jimbaxley/CodaToFramerCMS/blob/main/README.md" target="_blank" rel="noopener noreferrer">plug-in documentation</a>.
                        </p>
                    <button
                        type="submit"
                        disabled={isSyncing}
                        tabIndex={0}
                        className="back-button"
                    >
                        {isSyncing ? (
                            <div className="framer-spinner" />
                        ) : (
                            <span>
                                &rarr;  Import from "{dataSource.name && dataSource.name.trim() ? dataSource.name : dataSource.id}"
                            </span>
                        )}
                    </button>
                    <button
                        type="button"
                        onClick={onBack}
                        className="back-button back-button-dark"
                    >
                        Back
                    </button>
                </footer>
            </form>
        </main>
    )
}
