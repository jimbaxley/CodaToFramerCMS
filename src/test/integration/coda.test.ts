import { describe, it, expect, beforeAll } from 'vitest'
import { getCodaDataSource } from '../../data'
import { http, HttpResponse } from 'msw'
import { server } from '../setup'

describe('Coda API Integration', () => {
  // Skip tests if environment variables are not set
  const runIntegrationTests = process.env.CODA_API_KEY && 
    process.env.CODA_DOC_ID && 
    process.env.CODA_TABLE_ID

  beforeAll(() => {
    if (!runIntegrationTests) {
      console.warn('Skipping integration tests - missing environment variables')
      return
    }
    console.log('Integration Test Configuration:')
    console.log('API Key length:', process.env.CODA_API_KEY?.length)
    console.log('Doc ID:', process.env.CODA_DOC_ID)
    console.log('Table ID:', process.env.CODA_TABLE_ID)
  })

  ;(runIntegrationTests ? describe : describe.skip)('getCodaDataSource', () => {
    it('should fetch real data from Coda API', async () => {
      try {
        console.log('Starting API call...')
        const startTime = Date.now()

        const result = await getCodaDataSource(
          process.env.CODA_API_KEY!,
          process.env.CODA_DOC_ID!,
          process.env.CODA_TABLE_ID!
        )

        const endTime = Date.now()
        console.log(`API call completed in ${endTime - startTime}ms`)
        console.log('Full response data:', JSON.stringify(result, null, 2))
        console.log('Fields:', result.fields.map(f => ({ id: f.id, name: f.name, type: f.type })))
        console.log('First item:', JSON.stringify(result.items[0], null, 2))

        expect(result).toHaveProperty('id')
        expect(result).toHaveProperty('fields')
        expect(result).toHaveProperty('items')
        
        expect(Array.isArray(result.fields)).toBe(true)
        if (result.fields.length > 0) {
          const field = result.fields[0]
          expect(field).toHaveProperty('id')
          expect(field).toHaveProperty('name')
          expect(field).toHaveProperty('type')
        }

        expect(Array.isArray(result.items)).toBe(true)
        if (result.items.length > 0) {
          const item = result.items[0]
          expect(typeof item).toBe('object')
          expect(item).not.toBeNull()
        }
      } catch (error) {
        console.error('Test failed:', error)
        throw error
      }
    }, 30000)

    it('should handle invalid API key', async () => {
      // Override the handler for this specific test
      server.use(
        http.get('https://coda.io/apis/v1/docs/:docId/tables/:tableId/rows', () => {
          return new HttpResponse(null, { 
            status: 401,
            statusText: 'Unauthorized'
          })
        })
      )

      try {
        console.log('Testing invalid API key...')
        const startTime = Date.now()

        await expect(() =>
          getCodaDataSource(
            'invalid-api-key',
            process.env.CODA_DOC_ID!,
            process.env.CODA_TABLE_ID!
          )
        ).rejects.toThrow('Failed to fetch data from Coda: 401')

        const endTime = Date.now()
        console.log(`Invalid API test completed in ${endTime - startTime}ms`)
      } catch (error) {
        console.error('Invalid API key test failed:', error)
        throw error
      }
    }, 30000)
  })
})