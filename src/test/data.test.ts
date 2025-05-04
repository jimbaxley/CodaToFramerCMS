import { describe, it, expect } from 'vitest'
import { getCodaDataSource } from '../data'
import { server } from './setup'
import { http, HttpResponse } from 'msw'

describe('getCodaDataSource', () => {
  it('should fetch and transform data from Coda API correctly', async () => {
    const result = await getCodaDataSource(
      'test-api-key',
      'test-doc-id',
      'test-table-id'
    )

    expect(result).toEqual({
      id: 'test-table-id',
      fields: [
        { id: 'c-G5zaYaqf5D', name: 'c-G5zaYaqf5D', type: 'string' },
        { id: 'c-8uKSA5h1P6', name: 'c-8uKSA5h1P6', type: 'string' },
        { id: 'c-Yxqi55UM11', name: 'c-Yxqi55UM11', type: 'string' },
        { id: 'c-xM1UXlWtET', name: 'c-xM1UXlWtET', type: 'string' },
        { id: 'c-208f9ghsIT', name: 'c-208f9ghsIT', type: 'string' },
        { id: 'c-CuhtPto9h7', name: 'c-CuhtPto9h7', type: 'string' },
        { id: 'c-oQ9f2MSLrG', name: 'c-oQ9f2MSLrG', type: 'string' },
        { id: 'c-UqzlogrqaZ', name: 'c-UqzlogrqaZ', type: 'string' },
        { id: 'c-65xmsGtRJz', name: 'c-65xmsGtRJz', type: 'string' }
      ],
      items: [{
        'c-G5zaYaqf5D': { type: 'string', value: 'Published' },
        'c-8uKSA5h1P6': { type: 'string', value: 'Event' },
        'c-Yxqi55UM11': { type: 'string', value: 'Test Event' },
        'c-xM1UXlWtET': { type: 'string', value: '2025-05-04' },
        'c-208f9ghsIT': { type: 'string', value: 'Test Location' },
        'c-CuhtPto9h7': { type: 'string', value: 'Test Description' },
        'c-oQ9f2MSLrG': { type: 'string', value: 'https://test.com' },
        'c-UqzlogrqaZ': { type: 'string', value: 'test.jpg' },
        'c-65xmsGtRJz': { type: 'string', value: 'https://test.com/test.jpg' }
      }]
    })
  })

  it('should handle empty response from Coda API', async () => {
    server.use(
      http.get('https://coda.io/apis/v1/docs/:docId/tables/:tableId/rows', () => {
        return HttpResponse.json({ items: [] })
      })
    )

    const result = await getCodaDataSource(
      'test-api-key',
      'test-doc-id',
      'test-table-id'
    )

    expect(result).toEqual({
      id: 'test-table-id',
      fields: [],
      items: []
    })
  })

  it('should handle API errors correctly', async () => {
    server.use(
      http.get('https://coda.io/apis/v1/docs/:docId/tables/:tableId/rows', () => {
        return new HttpResponse(null, { status: 401 })
      })
    )

    await expect(
      getCodaDataSource('invalid-api-key', 'test-doc-id', 'test-table-id')
    ).rejects.toThrow('Failed to fetch data from Coda: ')
  })
})