import { type FieldDataEntryInput } from "framer-plugin"

// Extend base FieldDataEntryInput type to support displayValue for dates
export interface DateFieldDataEntryInput extends FieldDataEntryInput {
    type: 'date'
    value: string
    displayValue?: string
}

// Type guard to check if a field data entry is a date
export function isDateField(entry: FieldDataEntryInput): entry is DateFieldDataEntryInput {
    return entry.type === 'date';
}
