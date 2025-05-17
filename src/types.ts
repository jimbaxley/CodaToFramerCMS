import { type ManagedCollectionFieldInput, type FieldDataEntryInput, type EnumCaseData } from "framer-plugin";

// Base collection field input type
export type EnhancedCollectionFieldInput = ManagedCollectionFieldInput;

export interface CodaApiTypes {
    Column: {
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
    };
    Doc: {
        id: string;
        name: string;
        type: string;
    };
    Table: {
        id: string;
        name: string;
        type: string;
    };
}

export interface DataSourceModel {
    id: string;
    name?: string; // Add friendly name for the table
    fields: readonly ManagedCollectionFieldInput[];
    items: Record<string, FieldDataEntryInput>[];
}

export interface DataSourceResult {
    dataSource: DataSourceModel;
    showImageUrlWarning: boolean;
}

export type { EnumCaseData };

export interface CodaColumn {
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
