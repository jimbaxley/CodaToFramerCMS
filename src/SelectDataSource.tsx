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
            <hr className="sticky-divider" /> {/* Added sticky divider */}

            {step === 'api-key' && (
                // Form now acts as the step-form-wrapper
                <form onSubmit={handleApiKeySubmit} className="api-key-form step-form-wrapper" id="apiKeyForm">
                    {/* Content moved into a content-scrollable-area div */}
                    <div className="intro-screen content-scrollable-area">
                        <img src="/both.svg" alt="Connect Coda and Framer" className="welcome-graphic-intro" />
                        <h2>Connect Coda to Framer's CMS:</h2>
                        <ol className="steps-list">
                            <li>Enter your Coda API Key below.</li>
                            <li>Select your Coda Doc.</li>
                            <li>Choose your Table as a data source.</li>
                        </ol>
                        <p className="api-docs-link">
                            Need help?<br></br> Visit the <a href="https://github.com/jimbaxley/CodaToFramerCMS/blob/main/README.md" target="_blank" rel="noopener noreferrer">Github Documentation</a>.
                        </p>
                        <input
                            id="coda-api-key-input"
                            type="text"
                            value={apiKey}
                            onChange={e => setApiKey(e.target.value)}
                            placeholder="Enter your Coda API key"
                            required
                        />
                    </div>
                    <footer>
                        <hr className="sticky-top" />
                        <button type="submit" form="apiKeyForm" className="back-button">Next</button>
                    </footer>
                </form>
            )}

            {step === 'select-doc' && (
                <div className="step-form-wrapper"> {/* Added step-form-wrapper */}
                    <div className="selection-list content-scrollable-area"> {/* Added content-scrollable-area */}
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
                    <footer>
                        <hr className="sticky-top" />
                        <button type="button" onClick={() => setStep('api-key')} className="back-button">
                            Back
                        </button>
                    </footer>
                </div>
            )}

            {step === 'select-table' && (
                <div className="step-form-wrapper"> {/* Added step-form-wrapper */}
                    <div className="selection-list content-scrollable-area"> {/* Added content-scrollable-area */}
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
                        {/* Removed Time Format Preference Checkbox from here */}
                    </div>
                    <footer>
                        <hr className="sticky-top" />
                        <button type="button" onClick={() => setStep('select-doc')} className="back-button">
                            Back
                        </button>
                    </footer>
                </div>
            )}
        </main>
    )
}
