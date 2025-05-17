import { type FieldDataEntryInput } from "framer-plugin"

// Type guard to check if a field data entry is a date
export function isDateField(entry: FieldDataEntryInput): entry is DateFieldDataEntryInput {
    return entry.type === 'date';
}
