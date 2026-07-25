import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

const root = resolve(import.meta.dirname, '..')
const dist = join(root, 'dist-arcade')
const manifest = JSON.parse(readFileSync(join(root, 'game.manifest.json'), 'utf8'))
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const filesIn = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? filesIn(path) : [path]
})
const safe = (value) => {
    if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\') || value.split('/').includes('..')) {
        throw new Error(`[build-release] unsafe release path: ${value}`)
    }
    return value
}
if (typeof manifest.slug !== 'string' || !manifest.slug || manifest.schemaVersion !== 1) throw new Error('[build-release] manifest identity mismatch')

for (const source of manifest.media.makerIllustration.sources) {
    const target = join(dist, safe(source.releasePath))
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(join(root, safe(source.path)), target)
}
for (const asset of manifest.arcade.assets) {
    const target = join(dist, safe(asset.releasePath))
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(join(root, safe(asset.source)), target)
}

let releaseSha = process.env.RELEASE_SHA?.trim()
if (!releaseSha) {
    releaseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    if (execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()) releaseSha = `${releaseSha.slice(0, 12)}-dirty`
}
const assets = filesIn(dist).map((path) => ({ path, relativePath: relative(dist, path).replaceAll('\\', '/') }))
    .filter(({ relativePath }) => relativePath !== 'release.json').sort((a, b) => a.relativePath.localeCompare(b.relativePath))
    .map(({ path, relativePath }) => { const content = readFileSync(path); return { path: relativePath, bytes: content.byteLength, sha256: sha256(content) } })
const bytes = assets.reduce((sum, file) => sum + file.bytes, 0)
const codeGzipBytes = assets.filter((file) => /\.m?js$/.test(file.path)).reduce((sum, file) => sum + gzipSync(readFileSync(join(dist, file.path))).byteLength, 0)
if (bytes > 16 * 1024 * 1024 || assets.some((file) => file.bytes > 4 * 1024 * 1024) || codeGzipBytes > 1536 * 1024) throw new Error('[build-release] release budget exceeded')
const illustration = manifest.media.makerIllustration
const makerIllustration = { ...illustration, sources: illustration.sources.map((source) => {
    const file = assets.find((candidate) => candidate.path === source.releasePath)
    if (!file) throw new Error(`[build-release] missing maker illustration: ${source.releasePath}`)
    return { path: source.releasePath, width: source.width, height: source.height, type: source.type, sha256: file.sha256 }
}) }
const payload = {
    contractVersion: 1, gameId: manifest.slug, slug: manifest.slug, version: manifest.version, releaseSha,
    launchpadSha: manifest.source.launchpadCommit, entry: manifest.arcade.entry,
    style: assets.find((file) => file.path.endsWith('.css'))?.path ?? null,
    files: assets.length, bytes, codeGzipBytes, capabilities: manifest.arcade.capabilities,
    viewport: manifest.arcade.viewport, media: { makerIllustration }, assets,
}
writeFileSync(join(dist, 'release.json'), `${JSON.stringify({ ...payload, manifestSha256: sha256(JSON.stringify(payload)) }, null, 2)}\n`)
console.log(JSON.stringify({ files: assets.length, bytes, codeGzipBytes, releaseSha }, null, 2))
