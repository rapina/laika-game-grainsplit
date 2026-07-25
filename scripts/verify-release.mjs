import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

const root = resolve(import.meta.dirname, '..')
const dist = join(root, 'dist-arcade')
const manifest = JSON.parse(readFileSync(join(root, 'game.manifest.json'), 'utf8'))
const release = JSON.parse(readFileSync(join(dist, 'release.json'), 'utf8'))
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const filesIn = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? filesIn(path) : [path]
})
const fail = (message) => { throw new Error(`[verify-release] ${message}`) }
const { manifestSha256, ...payload } = release
if (sha256(JSON.stringify(payload)) !== manifestSha256) fail('manifest hash mismatch')
if (release.contractVersion !== 1 || release.slug !== manifest.slug || release.gameId !== manifest.slug) fail('identity mismatch')
if (release.entry !== manifest.arcade.entry || release.version !== manifest.version || release.launchpadSha !== manifest.source.launchpadCommit) fail('manifest metadata mismatch')
const actual = filesIn(dist).map((path) => relative(dist, path).replaceAll('\\', '/')).filter((path) => path !== 'release.json').sort()
const declared = release.assets.map((file) => file.path).sort()
if (JSON.stringify(actual) !== JSON.stringify(declared)) fail('file set mismatch')
let bytes = 0
let codeGzipBytes = 0
for (const file of release.assets) {
    const path = resolve(dist, file.path)
    if (!path.startsWith(`${dist}/`) || !existsSync(path) || !statSync(path).isFile()) fail(`missing ${file.path}`)
    const content = readFileSync(path)
    if (content.byteLength !== file.bytes || sha256(content) !== file.sha256) fail(`hash mismatch ${file.path}`)
    if (file.path.endsWith('.map') || /(^|\/)(source|sources|original|prompt)(\/|$)/.test(file.path) || /^art\/laika.*\.png$/i.test(file.path)) fail(`source material shipped ${file.path}`)
    bytes += content.byteLength
    if (/\.m?js$/.test(file.path)) codeGzipBytes += gzipSync(content).byteLength
}
if (release.files !== release.assets.length || release.bytes !== bytes || release.codeGzipBytes !== codeGzipBytes) fail('release totals mismatch')
if (!declared.includes(release.entry) || (release.style && !declared.includes(release.style))) fail('entry or style missing')
const expected = manifest.media.makerIllustration
const actualMaker = release.media.makerIllustration
if (JSON.stringify(actualMaker.focalPoint) !== JSON.stringify(expected.focalPoint) || JSON.stringify(actualMaker.alt) !== JSON.stringify(expected.alt)) fail('maker metadata mismatch')
for (const [index, source] of expected.sources.entries()) {
    const built = actualMaker.sources[index]
    if (!built || built.path !== source.releasePath || built.width !== source.width || built.height !== source.height || built.type !== 'image/jpeg') fail('maker source mismatch')
}
console.log(`Verified ${release.files} immutable files (${release.bytes} bytes, ${release.codeGzipBytes} JS gzip bytes)`)
