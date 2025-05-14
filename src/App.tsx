import "./App.css"

import { framer, type ManagedCollection } from "framer-plugin"
import { useEffect, useLayoutEffect, useState } from "react"
import { type DataSource, getDataSource, getCodaDataSource } from "./data"
import { FieldMapping } from "./FieldMapping"
import { SelectDataSource } from "./SelectDataSource"

interface AppProps {
    collection: ManagedCollection
    previousDataSourceId: string | null
    previousSlugFieldId: string | null
}

export function App({ collection, previousDataSourceId, previousSlugFieldId }: AppProps) {
    const [dataSource, setDataSource] = useState<DataSource | null>(null)
    const [isLoadingDataSource, setIsLoadingDataSource] = useState(false)

    const handleSelectDataSource = async (config: { apiKey: string; docId: string; tableId: string }) => {
        setIsLoadingDataSource(true)
        try {
            const dataSource = await getCodaDataSource(config.apiKey, config.docId, config.tableId)
            
            // Store the Coda credentials
            await collection.setPluginData('apiKey', config.apiKey)
            await collection.setPluginData('docId', config.docId)
            await collection.setPluginData('tableId', config.tableId)
            
            setDataSource(dataSource)
        } catch (error) {
            console.error(error)
            framer.notify("Failed to load data source. Check the logs for more details.", { variant: "error" })
        } finally {
            setIsLoadingDataSource(false)
        }
    }

    const handleGoBackToDataSourceSelection = () => {
        setDataSource(null)
        // Clear stored Coda credentials when going back
        collection.setPluginData('apiKey', null)
        collection.setPluginData('docId', null)
        collection.setPluginData('tableId', null)
    }

    useLayoutEffect(() => {
        const hasDataSourceSelected = Boolean(dataSource)

        framer.showUI({
            width: hasDataSourceSelected ? 360 : 300,
            height: hasDataSourceSelected ? 425 : 400,
            minWidth: hasDataSourceSelected ? 360 : undefined,
            minHeight: hasDataSourceSelected ? 425 : undefined,
            resizable: hasDataSourceSelected,
        })
    }, [dataSource])

    useEffect(() => {
        if (!previousDataSourceId) {
            return
        }

        const abortController = new AbortController()

        setIsLoadingDataSource(true)
        getDataSource(abortController.signal)
            .then(setDataSource)
            .catch(error => {
                if (abortController.signal.aborted) return

                console.error("Failed to load data source:", error)
                setDataSource(null)  // Reset data source on error
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

    if (!dataSource) {
        return <SelectDataSource onSelectDataSource={handleSelectDataSource} />
    }

    return <FieldMapping collection={collection} dataSource={dataSource} initialSlugFieldId={previousSlugFieldId} onBack={handleGoBackToDataSourceSelection} />
}
