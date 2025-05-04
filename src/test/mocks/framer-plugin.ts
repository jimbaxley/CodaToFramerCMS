import { vi } from 'vitest'

export const framerPluginMock = {
    notify: vi.fn(),
    closePlugin: vi.fn(),
    mode: 'default',
    showUI: vi.fn(),
}

vi.mock('framer-plugin', () => ({
    framer: framerPluginMock,
}))