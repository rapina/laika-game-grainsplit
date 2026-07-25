import { beforeEach } from 'vitest'

/**
 * Test environment is plain node — provide an in-memory localStorage so
 * storage-backed modules (records, settings, entitlements) are testable
 * without a browser. Reset between tests.
 */
class MemoryStorage implements Storage {
    private map = new Map<string, string>()

    get length(): number { return this.map.size }
    clear(): void { this.map.clear() }
    getItem(key: string): string | null { return this.map.has(key) ? this.map.get(key)! : null }
    key(index: number): string | null { return [...this.map.keys()][index] ?? null }
    removeItem(key: string): void { this.map.delete(key) }
    setItem(key: string, value: string): void { this.map.set(key, String(value)) }
}

Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    writable: true,
    configurable: true,
})

beforeEach(() => {
    localStorage.clear()
})
