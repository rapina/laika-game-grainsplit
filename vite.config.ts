import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import packageJson from './package.json'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig(({ mode }) => {
    const isCapacitorBuild = process.env.CAPACITOR_BUILD === 'true'
    const isTossBuild = process.env.VITE_PLATFORM === 'toss'
    const isArcadeBuild = process.env.VITE_DISTRIBUTION === 'arcade'
    const isDebugBuild = mode === 'development'

    return {
        define: {
            __APP_VERSION__: JSON.stringify(packageJson.version),
            __DEV_BUILD__: JSON.stringify(isDebugBuild),
            __PLATFORM__: JSON.stringify(isTossBuild ? 'toss' : 'default'),
            __DISTRIBUTION__: JSON.stringify(isArcadeBuild ? 'arcade' : 'standalone'),
        },
        plugins: [react()],
        base: isCapacitorBuild || isArcadeBuild ? './' : '/',
        build: {
            outDir: isArcadeBuild ? 'dist-arcade' : 'dist',
            minify: isDebugBuild ? false : 'esbuild',
            sourcemap: isDebugBuild,
            ...(isArcadeBuild ? {
                copyPublicDir: false,
                lib: {
                    entry: resolve(rootDir, 'src/arcadeEntry.ts'),
                    formats: ['es'],
                    fileName: () => 'entry.mjs',
                    cssFileName: 'style',
                },
                rollupOptions: { output: { assetFileNames: 'assets/[name]-[hash][extname]' } },
            } : {}),
        },
    }
})
