import { config } from 'dotenv'
import { expect, afterEach, afterAll, beforeAll, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'

// Set up DOM environment
import '@testing-library/jest-dom'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost'
})
global.window = dom.window as unknown as Window & typeof globalThis
global.document = dom.window.document
global.navigator = dom.window.navigator

// Load environment variables
config()

// Add jest-dom matchers
expect.extend(matchers)

// Mock Framer Plugin API
export const framerPluginMock = {
    notify: vi.fn(),
    closePlugin: vi.fn(),
    mode: 'default',
    showUI: vi.fn(),
}

vi.mock('framer-plugin', () => ({
    framer: framerPluginMock
}))

// Clean up after each test
afterEach(() => {
    cleanup()
    vi.clearAllMocks()
})

// Mock Coda API handlers
export const handlers = [
    http.get('https://coda.io/apis/v1/docs/:docId/tables/:tableId/rows', () => {
        return HttpResponse.json({
            items: [
                {
                    id: "row-1",
                    values: {
                        "c-G5zaYaqf5D": "Published",
                        "c-8uKSA5h1P6": "Event",
                        "c-Yxqi55UM11": "Test Event",
                        "c-xM1UXlWtET": "2025-05-04",
                        "c-208f9ghsIT": "Test Location",
                        "c-CuhtPto9h7": "Test Description",
                        "c-oQ9f2MSLrG": "https://test.com",
                        "c-UqzlogrqaZ": "test.jpg",
                        "c-65xmsGtRJz": "https://test.com/test.jpg"
                    }
                }
            ]
        })
    })
]

// Set up MSW server
const server = setupServer(...handlers)

// Start server before all tests
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))

// Reset handlers after each test
afterEach(() => server.resetHandlers())

// Clean up after all tests are done
afterAll(() => server.close())

// Export server and mock for use in tests
export { server }