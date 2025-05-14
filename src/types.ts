import { type ManagedCollectionFieldInput, type FieldDataEntryInput, type EnumCaseData } from "framer-plugin"

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
    fields: readonly ManagedCollectionFieldInput[];
    items: Record<string, FieldDataEntryInput>[];
}

export interface DataSourceResult {
    dataSource: DataSourceModel;
    showImageUrlWarning: boolean;
}

export type { EnumCaseData };
