import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SelectDataSource } from '../../SelectDataSource'
import { framerPluginMock } from '../mocks/framer-plugin'
import '../mocks/framer-plugin'

describe('SelectDataSource', () => {
    const mockOnSelectDataSource = vi.fn()

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('renders the Coda configuration form', () => {
        render(<SelectDataSource onSelectDataSource={mockOnSelectDataSource} />)
        
        expect(screen.getByLabelText(/Coda API Key/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/Coda Doc ID/i)).toBeInTheDocument()
        expect(screen.getByLabelText(/Coda Table ID/i)).toBeInTheDocument()
    })

    it('validates required fields before submission', async () => {
        render(<SelectDataSource onSelectDataSource={mockOnSelectDataSource} />)
        
        fireEvent.click(screen.getByRole('button'))
        
        expect(framerPluginMock.notify).toHaveBeenCalledWith(
            "Please fill in all fields.",
            { variant: "warning" }
        )
        expect(mockOnSelectDataSource).not.toHaveBeenCalled()
    })

    it('calls onSelectDataSource with form data when submitted', async () => {
        render(<SelectDataSource onSelectDataSource={mockOnSelectDataSource} />)
        
        const apiKeyInput = screen.getByLabelText(/Coda API Key/i)
        const docIdInput = screen.getByLabelText(/Coda Doc ID/i)
        const tableIdInput = screen.getByLabelText(/Coda Table ID/i)

        fireEvent.change(apiKeyInput, { target: { value: 'test-api-key' } })
        fireEvent.change(docIdInput, { target: { value: 'test-doc-id' } })
        fireEvent.change(tableIdInput, { target: { value: 'test-table-id' } })

        fireEvent.click(screen.getByRole('button'))

        expect(mockOnSelectDataSource).toHaveBeenCalledWith({
            apiKey: 'test-api-key',
            docId: 'test-doc-id',
            tableId: 'test-table-id'
        })
    })

    it('shows loading state during submission', async () => {
        render(<SelectDataSource onSelectDataSource={mockOnSelectDataSource} />)
        
        const apiKeyInput = screen.getByLabelText(/Coda API Key/i)
        const docIdInput = screen.getByLabelText(/Coda Doc ID/i)
        const tableIdInput = screen.getByLabelText(/Coda Table ID/i)

        fireEvent.change(apiKeyInput, { target: { value: 'test-api-key' } })
        fireEvent.change(docIdInput, { target: { value: 'test-doc-id' } })
        fireEvent.change(tableIdInput, { target: { value: 'test-table-id' } })

        fireEvent.click(screen.getByRole('button'))

        expect(screen.getByRole('button')).toBeDisabled()
        expect(screen.getByRole('button')).toHaveClass('framer-spinner')
    })
})