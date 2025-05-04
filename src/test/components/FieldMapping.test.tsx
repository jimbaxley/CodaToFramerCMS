import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FieldMapping } from '../../FieldMapping'
import { framerPluginMock } from '../mocks/framer-plugin'
import '../mocks/framer-plugin'

const mockCollection = {
    getFields: vi.fn().mockResolvedValue([]),
    getItemIds: vi.fn().mockResolvedValue([]),
    setFields: vi.fn(),
    addItems: vi.fn(),
    removeItems: vi.fn(),
    setPluginData: vi.fn(),
}

const mockDataSource = {
    id: 'test-table',
    fields: [
        { id: 'c-G5zaYaqf5D', name: 'status', type: 'string' },
        { id: 'c-8uKSA5h1P6', name: 'type', type: 'string' },
        { id: 'c-Yxqi55UM11', name: 'title', type: 'string' },
    ],
    items: [
        {
            'c-G5zaYaqf5D': { type: 'string', value: 'Published' },
            'c-8uKSA5h1P6': { type: 'string', value: 'Event' },
            'c-Yxqi55UM11': { type: 'string', value: 'Test Event' },
        }
    ]
}

describe('FieldMapping', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('renders the field mapping interface', async () => {
        render(
            <FieldMapping
                collection={mockCollection}
                dataSource={mockDataSource}
                initialSlugFieldId={null}
            />
        )

        expect(screen.getByLabelText(/Slug Field/i)).toBeInTheDocument()
        expect(screen.getByText('status')).toBeInTheDocument()
        expect(screen.getByText('type')).toBeInTheDocument()
        expect(screen.getByText('title')).toBeInTheDocument()
    })

    it('allows selecting a slug field', async () => {
        render(
            <FieldMapping
                collection={mockCollection}
                dataSource={mockDataSource}
                initialSlugFieldId={null}
            />
        )

        const slugSelect = screen.getByLabelText(/Slug Field/i)
        fireEvent.change(slugSelect, { target: { value: 'c-Yxqi55UM11' } })

        expect(slugSelect).toHaveValue('c-Yxqi55UM11')
    })

    it('validates slug field selection before import', async () => {
        render(
            <FieldMapping
                collection={mockCollection}
                dataSource={mockDataSource}
                initialSlugFieldId={null}
            />
        )

        const importButton = screen.getByText(/Import/i)
        fireEvent.click(importButton)

        expect(framerPluginMock.notify).toHaveBeenCalledWith(
            'Please select a slug field before importing.',
            { variant: 'warning' }
        )
    })

    it('allows toggling fields on/off', async () => {
        render(
            <FieldMapping
                collection={mockCollection}
                dataSource={mockDataSource}
                initialSlugFieldId="c-Yxqi55UM11"
            />
        )

        const fieldToggle = screen.getByText('status').closest('button')
        fireEvent.click(fieldToggle!)

        // Should be disabled after clicking
        expect(fieldToggle).toHaveAttribute('aria-disabled', 'true')
    })

    it('shows loading state during sync', async () => {
        render(
            <FieldMapping
                collection={mockCollection}
                dataSource={mockDataSource}
                initialSlugFieldId="c-Yxqi55UM11"
            />
        )

        const slugSelect = screen.getByLabelText(/Slug Field/i)
        fireEvent.change(slugSelect, { target: { value: 'c-Yxqi55UM11' } })

        const importButton = screen.getByText(/Import/i)
        fireEvent.click(importButton)

        expect(screen.getByRole('button', { name: /Import/i })).toBeDisabled()
        expect(screen.getByRole('button', { name: /Import/i })).toContainElement(
            screen.getByClass('framer-spinner')
        )
    })
})