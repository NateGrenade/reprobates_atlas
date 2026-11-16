import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
export default defineConfig({ resolve: { alias: { '@core': resolve(import.meta.dirname, 'core') } }, test: { include: ['tests/**/*.test.ts'], testTimeout: 20000 } })
