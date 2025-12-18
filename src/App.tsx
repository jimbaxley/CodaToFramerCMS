import "./App.css"

import { framer, type ManagedCollection } from "framer-plugin"
import { useEffect, useLayoutEffect, useState } from "react"
import { getDataSource, getCodaDataSource, type GetDataSourceResult } from "./data"
import { FieldMapping } from "./FieldMapping"
import { SelectDataSource } from "./SelectDataSource"

interface AppProps {
    collection: ManagedCollection
    previousDataSourceId: string | null
    previousSlugFieldId: string | null
}

export function App({ collection, previousDataSourceId, previousSlugFieldId }: AppProps) {
    const [dataSourceResult, setDataSourceResult] = useState<GetDataSourceResult | null>(null)
    const [isLoadingDataSource, setIsLoadingDataSource] = useState(false)
    const [hasShownImageUrlWarning, setHasShownImageUrlWarning] = useState(false);
    const [selectedTableName, setSelectedTableName] = useState<string | undefined>(undefined); // Store table name

    // Accept tableName from SelectDataSource
    const handleSelectDataSource = async (config: { apiKey: string; docId: string; tableId: string; tableName: string }) => {
        setIsLoadingDataSource(true)
        setHasShownImageUrlWarning(false);
        setSelectedTableName(config.tableName); // Store for later
        try {
            const result = await getCodaDataSource(config.apiKey, config.docId, config.tableId, config.tableName)
            
            // Store the Coda credentials
            await collection.setPluginData('apiKey', config.apiKey)
            await collection.setPluginData('docId', config.docId)
            await collection.setPluginData('tableId', config.tableId)
            await collection.setPluginData('tableName', config.tableName)
            
            setDataSourceResult(result) // Set the full result
        } catch (error) {
            console.error(error)
            framer.notify("Failed to load data source. Check the logs for more details.", { variant: "error" })
        } finally {
            setIsLoadingDataSource(false)
        }
    }

    const handleGoBackToDataSourceSelection = async () => {
        // Get current API key and doc ID to maintain them
        const apiKey = await collection.getPluginData('apiKey')
        const docId = await collection.getPluginData('docId')
        if (!apiKey || !docId) {
            // If we don't have these, something's wrong - start over
            setDataSourceResult(null)
            return
        }

        // Preload the docs and tables before clearing the current view
        try {
            // Commented out due to missing imports
            /*
            const docs = await getCodaDocs(apiKey)
            const tables = await getCodaTables(apiKey, docId)
            
            // Store this data in sessionStorage for the SelectDataSource component to use
            sessionStorage.setItem('preloadedDocs', JSON.stringify(docs))
            sessionStorage.setItem('preloadedTables', JSON.stringify(tables))
            sessionStorage.setItem('preloadedApiKey', apiKey)
            sessionStorage.setItem('preloadedDocId', docId)
            */

            // Clear only the table selection
            await collection.setPluginData('tableId', null)
            setDataSourceResult(null) // This will return us to SelectDataSource
        } catch (error) {
            console.error("Error preloading data for back navigation:", error)
            // If there's an error, just do a clean reset
            setDataSourceResult(null)
        }
    }

    useLayoutEffect(() => {
        const hasDataSourceSelected = Boolean(dataSourceResult?.dataSource) // Check within result

        framer.showUI({
            width: hasDataSourceSelected ? 360 : 380,
            height: hasDataSourceSelected ? 425 : 500,
            minWidth: hasDataSourceSelected ? 360 : undefined,
            minHeight: hasDataSourceSelected ? 425 : undefined,
            resizable: hasDataSourceSelected,
        })
    }, [dataSourceResult])

    useEffect(() => {
        if (dataSourceResult?.dataSource && dataSourceResult.showImageUrlWarning && !hasShownImageUrlWarning) {
            framer.notify(
                "This Coda table has Image columns; use a URL field instead.", 
                { variant: "warning" }
            );
            setHasShownImageUrlWarning(true);
        }
    }, [dataSourceResult, hasShownImageUrlWarning]);

    useEffect(() => {
        if (!previousDataSourceId) {
            return
        }

        const abortController = new AbortController()

        setIsLoadingDataSource(true)
        setHasShownImageUrlWarning(false); // Reset warning flag
        getDataSource(abortController.signal)
            .then(result => {
                if (!abortController.signal.aborted) {
                    setDataSourceResult(result); // Set the full result
                }
            })
            .catch(error => {
                if (abortController.signal.aborted) return

                console.error("Failed to load data source:", error)
                setDataSourceResult(null)  // Reset data source on error
                framer.notify(
                    `Error loading data source: ${error.message}`,
                    { variant: "error" }
                )
            })
            .finally(() => {
                if (abortController.signal.aborted) return
                setIsLoadingDataSource(false)
            })

        return () => {
            abortController.abort()
        }
    }, [previousDataSourceId])

    if (isLoadingDataSource) {
        return (
            <main className="loading">
                <div className="framer-spinner" />
            </main>
        )
    }

    if (!dataSourceResult?.dataSource) { // Check within result
        return <SelectDataSource onSelectDataSource={handleSelectDataSource} />
    }

    return <FieldMapping collection={collection} dataSourceResult={{...dataSourceResult, dataSource: {...dataSourceResult.dataSource, name: dataSourceResult.dataSource.name || selectedTableName} }} initialSlugFieldId={previousSlugFieldId} onBack={handleGoBackToDataSourceSelection} /> // Pass full result
}
