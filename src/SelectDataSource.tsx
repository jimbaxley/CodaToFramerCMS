import { framer } from "framer-plugin"
import { useState, useEffect } from "react"
import { type CodaDoc, type CodaTable } from "./types"

// Replace the placeholder getCodaDocs and getCodaTables with real implementations that fetch from the Coda API
async function getCodaDocs(apiKey: string, signal?: AbortSignal): Promise<CodaDoc[]> {
    const response = await fetch("https://coda.io/apis/v1/docs", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal,
    });
    if (!response.ok) return [];
    const data = await response.json();
    // Logging removed for docs
    return data.items || [];
}

async function getCodaTables(apiKey: string, docId: string, signal?: AbortSignal): Promise<CodaTable[]> {
    const response = await fetch(`https://coda.io/apis/v1/docs/${docId}/tables`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal,
    });
    if (!response.ok) return [];
    const data = await response.json();
    // Logging removed
    return data.items || [];
}

interface SelectDataSourceProps {
    onSelectDataSource: (config: { apiKey: string; docId: string; tableId: string; tableName: string }) => void
}

export function SelectDataSource({ onSelectDataSource }: SelectDataSourceProps) {
    const [step, setStep] = useState<'api-key' | 'direct-ids' | 'select-doc' | 'select-table'>('api-key')
    const [apiKey, setApiKey] = useState("")
    const [useDirectIds, setUseDirectIds] = useState(false)
    const [directDocId, setDirectDocId] = useState("")
    const [directTableId, setDirectTableId] = useState("")
    const [directTableName, setDirectTableName] = useState("")
    const [docs, setDocs] = useState<CodaDoc[]>([])
    const [selectedDoc, setSelectedDoc] = useState<CodaDoc | null>(null)
    const [tables, setTables] = useState<CodaTable[]>([])
    const [isLoading, setIsLoading] = useState(false)

    // Check for existing credentials on mount
    useEffect(() => {
        const loadExistingCredentials = async () => {
            // First check for preloaded data from back navigation
            const preloadedApiKey = sessionStorage.getItem('preloadedApiKey')
            const preloadedDocId = sessionStorage.getItem('preloadedDocId')
            const preloadedDocsJson = sessionStorage.getItem('preloadedDocs')
            const preloadedTablesJson = sessionStorage.getItem('preloadedTables')

            if (preloadedApiKey && preloadedDocId && preloadedDocsJson && preloadedTablesJson) {
                // Use the preloaded data
                const preloadedDocs = JSON.parse(preloadedDocsJson)
                const preloadedTables = JSON.parse(preloadedTablesJson)
                
                setApiKey(preloadedApiKey)
                setDocs(preloadedDocs)
                
                const savedDoc = preloadedDocs.find((doc: CodaDoc) => doc.id === preloadedDocId)
                if (savedDoc) {
                    setSelectedDoc(savedDoc)
                    setTables(preloadedTables)
                    setStep('select-table')
                }

                // Clear the preloaded data
                sessionStorage.removeItem('preloadedApiKey')
                sessionStorage.removeItem('preloadedDocId')
                sessionStorage.removeItem('preloadedDocs')
                sessionStorage.removeItem('preloadedTables')
                return
            }

            // Fall back to loading from collection storage if no preloaded data
            const collection = await framer.getActiveManagedCollection()
            const savedApiKey = await collection.getPluginData('apiKey')
            const savedDocId = await collection.getPluginData('docId')
            
            if (savedApiKey && savedDocId) {
                setApiKey(savedApiKey)
                
                try {
                    const docs = await getCodaDocs(savedApiKey)
                    setDocs(docs)
                    
                    const savedDoc = docs.find(doc => doc.id === savedDocId)
                    if (savedDoc) {
                        setSelectedDoc(savedDoc)
                        setStep('select-table')
                        
                        const tables = await getCodaTables(savedApiKey, savedDocId)
                        setTables(tables)
                    }
                } catch (error) {
                    console.error("Error loading saved credentials:", error)
                }
            }
        }

        loadExistingCredentials()
    }, [])

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
        
        // Route to appropriate next step based on direct IDs checkbox
        if (useDirectIds) {
            setStep('direct-ids')
        } else {
            setStep('select-doc')
        }
    }

    const handleDirectIdsSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (!directDocId || !directTableId) {
            framer.notify("Please enter both Doc ID and Table ID.", { variant: "warning" })
            return
        }
        
        // Validate by trying to fetch the table
        setIsLoading(true)
        const tableUrl = `https://coda.io/apis/v1/docs/${directDocId}/tables/${directTableId}`
        fetch(tableUrl, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        })
            .then(async response => {
                if (!response.ok) {
                    if (response.status === 401) {
                        throw new Error("Invalid API key")
                    } else if (response.status === 404) {
                        throw new Error("Document or table not found. Please check your IDs.")
                    } else {
                        throw new Error(`Failed to validate: ${response.status}`)
                    }
                }
                const tableData = await response.json() as { name: string }
                onSelectDataSource({
                    apiKey,
                    docId: directDocId,
                    tableId: directTableId,
                    tableName: directTableName || tableData.name || "Untitled Table"
                })
            })
            .catch(error => {
                framer.notify(error.message, { variant: "error" })
            })
            .finally(() => {
                setIsLoading(false)
            })
    }

    const handleDocSelect = (doc: CodaDoc) => {
        setSelectedDoc(doc)
        setStep('select-table')
    }

    const handleTableSelect = (table: CodaTable) => {
        onSelectDataSource({
            apiKey,
            docId: selectedDoc?.id || '',
            tableId: table.id,
            tableName: table.name
        });
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
                <form onSubmit={handleApiKeySubmit} className="api-key-form step-form-wrapper" id="apiKeyForm">
                    <div className="intro-screen content-scrollable-area">
                        <img src="/both.svg" alt="Connect Coda and Framer" className="welcome-graphic-intro" />
                        <h2>Connect Coda to Framer's CMS:</h2>
                        
                        <div className="connection-mode-selector">
                            <label className="radio-option">
                                <input
                                    type="radio"
                                    name="connection-mode"
                                    checked={!useDirectIds}
                                    onChange={() => setUseDirectIds(false)}
                                />
                                <span className="radio-label">
                                    <strong>Browse Docs & Tables</strong>
                                    <span className="radio-description">Select from a list of your Coda docs and tables</span>
                                </span>
                            </label>
                            
                            <label className="radio-option">
                                <input
                                    type="radio"
                                    name="connection-mode"
                                    checked={useDirectIds}
                                    onChange={() => setUseDirectIds(true)}
                                />
                                <span className="radio-label">
                                    <strong>Direct IDs</strong>
                                    <span className="radio-description">For restricted API tokens - enter IDs manually</span>
                                </span>
                            </label>
                        </div>
                        
                        <ol className="steps-list">
                            <li>Enter your Coda API Key below.</li>
                            <li>{useDirectIds ? 'Enter your Doc ID and Table ID.' : 'Select your Coda Doc.'}</li>
                            <li>{useDirectIds ? 'Click Connect to sync your data.' : 'Choose your Table as a data source.'}</li>
                        </ol>
                        
                        <input
                            id="coda-api-key-input"
                            type="text"
                            value={apiKey}
                            onChange={e => setApiKey(e.target.value)}
                            placeholder="Enter your Coda API key"
                            required
                        />
                        <p className="api-docs-link">
                            Need help?<br></br> See <a href="https://github.com/jimbaxley/CodaToFramerCMS/blob/main/README.md" target="_blank" rel="noopener noreferrer">plug-in documentation</a>.
                        </p>
                    </div>
                    <footer>
                        <hr className="sticky-top" />
                        <button type="submit" form="apiKeyForm" className="primary-button">
                            Next
                        </button>
                    </footer>
                </form>
            )}

            {step === 'direct-ids' && (
                <form onSubmit={handleDirectIdsSubmit} className="step-form-wrapper" id="directIdsForm">
                    <div className="intro-screen content-scrollable-area">
                        <h2>Enter Doc and Table IDs</h2>
                        <p className="field-description">
                            Enter your Coda document and table IDs directly. This is useful when using restricted API tokens.
                        </p>
                        
                        <div className="two-column-layout">
                            <div className="input-column">
                                <input
                                    type="text"
                                    value={directDocId}
                                    onChange={e => setDirectDocId(e.target.value)}
                                    placeholder="Doc ID (e.g., OySK5JOQh-)"
                                    required
                                    className="direct-id-input"
                                />
                                
                                <input
                                    type="text"
                                    value={directTableId}
                                    onChange={e => setDirectTableId(e.target.value)}
                                    placeholder="Table ID (e.g., grid-D-q_wRcl21)"
                                    required
                                    className="direct-id-input"
                                />
                                
                                <input
                                    type="text"
                                    value={directTableName}
                                    onChange={e => setDirectTableName(e.target.value)}
                                    placeholder="Table Name (optional)"
                                    className="direct-id-input"
                                />
                            </div>
                            
                            <div className="info-column">
                                <p className="field-hint">
                                    Found in your doc URL: <code>coda.io/d/_d<strong>OySK5JOQh-</strong></code>
                                </p>
                                
                                <p className="field-hint">
                                    Right-click table → Copy table URL → extract ID from: <code>...#<strong>grid-D-q_wRcl21</strong></code>
                                </p>
                                
                                <p className="field-hint">
                                    Custom name for this table (if left blank, will use name from Coda)
                                </p>
                            </div>
                        </div>
                    </div>
                    <footer>
                        <hr className="sticky-top" />
                        <button type="button" onClick={() => setStep('api-key')} className="secondary-button">
                            Back
                        </button>
                        <button type="submit" form="directIdsForm" className="primary-button">
                            Connect
                        </button>
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
                        <button type="button" onClick={() => setStep('api-key')} className="secondary-button">
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
                        <button type="button" onClick={() => setStep('select-doc')} className="secondary-button">
                            Back
                        </button>
                    </footer>
                </div>
            )}
        </main>
    )
}
