import { framer } from "framer-plugin"
import { useState, useEffect } from "react"
import { getCodaDocs, getCodaTables, type CodaDoc, type CodaTable } from "./data"

interface SelectDataSourceProps {
    onSelectDataSource: (config: { apiKey: string; docId: string; tableId: string }) => void
}

export function SelectDataSource({ onSelectDataSource }: SelectDataSourceProps) {
    const [step, setStep] = useState<'api-key' | 'select-doc' | 'select-table'>('api-key')
    const [apiKey, setApiKey] = useState("")
    const [docs, setDocs] = useState<CodaDoc[]>([])
    const [selectedDoc, setSelectedDoc] = useState<CodaDoc | null>(null)
    const [tables, setTables] = useState<CodaTable[]>([])
    const [selectedTable, setSelectedTable] = useState<CodaTable | null>(null)
    const [isLoading, setIsLoading] = useState(false)

    // Fetch docs when API key is provided
    useEffect(() => {
        if (!apiKey || step !== 'select-doc') return
        
        const abortController = new AbortController()
        setIsLoading(true)

        getCodaDocs(apiKey, abortController.signal)
            .then(docs => {
                if (!abortController.signal.aborted) {
                    setDocs(docs)
                    setIsLoading(false)
                }
            })
            .catch(error => {
                if (!abortController.signal.aborted) {
                    console.error(error)
                    framer.notify("Failed to fetch docs. Check the logs for more details.", { variant: "error" })
                    setIsLoading(false)
                }
            })

        return () => abortController.abort()
    }, [apiKey, step])

    // Fetch tables when doc is selected
    useEffect(() => {
        if (!apiKey || !selectedDoc || step !== 'select-table') return
        
        const abortController = new AbortController()
        setIsLoading(true)

        getCodaTables(apiKey, selectedDoc.id, abortController.signal)
            .then(tables => {
                if (!abortController.signal.aborted) {
                    setTables(tables)
                    setIsLoading(false)
                }
            })
            .catch(error => {
                if (!abortController.signal.aborted) {
                    console.error(error)
                    framer.notify("Failed to fetch tables. Check the logs for more details.", { variant: "error" })
                    setIsLoading(false)
                }
            })

        return () => abortController.abort()
    }, [apiKey, selectedDoc, step])

    const handleApiKeySubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (!apiKey) {
            framer.notify("Please enter your API key.", { variant: "warning" })
            return
        }
        setStep('select-doc')
    }

    const handleDocSelect = (doc: CodaDoc) => {
        setSelectedDoc(doc)
        setStep('select-table')
    }

    const handleTableSelect = (table: CodaTable) => {
        setSelectedTable(table)
        onSelectDataSource({ 
            apiKey, 
            docId: selectedDoc?.id || '', 
            tableId: table.id 
        })
    }

    if (isLoading) {
        return (
            <main className="loading">
                <div className="framer-spinner" />
            </main>
        )
    }

    return (
        <main className="framer-hide-scrollbar setup">
            {step === 'api-key' && (
                <form onSubmit={handleApiKeySubmit}>
                    <label>
                        Coda API Key
                        <input
                            type="text"
                            value={apiKey}
                            onChange={e => setApiKey(e.target.value)}
                            placeholder="Enter your Coda API key"
                            required
                        />
                    </label>
                    <button type="submit">Next</button>
                </form>
            )}

            {step === 'select-doc' && (
                <div className="selection-list">
                    <h2>Select a Doc</h2>
                    {docs.map(doc => (
                        <button
                            key={doc.id}
                            className="list-item"
                            onClick={() => handleDocSelect(doc)}
                        >
                            {doc.name}
                        </button>
                    ))}
                </div>
            )}

            {step === 'select-table' && (
                <div className="selection-list">
                    <h2>Select a Table</h2>
                    {tables.map(table => (
                        <button
                            key={table.id}
                            className="list-item"
                            onClick={() => handleTableSelect(table)}
                        >
                            {table.name}
                        </button>
                    ))}
                </div>
            )}
        </main>
    )
}
