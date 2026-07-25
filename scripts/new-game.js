/**
 * One-shot project initializer — run right after copying the template.
 *
 *   node scripts/new-game.js --id com.studio.mygame --name "MY GAME" \
 *       --slug mygame --display "내 게임"
 *
 *   --id       Android applicationId / Capacitor appId (reverse-DNS)
 *   --name     Store-facing app name (English, used in strings.xml / title)
 *   --slug     short lowercase id: Toss appName, npm package name,
 *              localStorage prefix. [a-z0-9]+ only.
 *   --display  Toss brand displayName (Korean, shown in the Toss app)
 *
 * Rewrites every place the template identity is hardcoded, moves the Android
 * MainActivity package directory, and resets the version to 0.0.1.
 * Idempotent: running twice is a no-op.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const OLD = {
    id: 'com.example.gametemplate',
    name: 'Game Template',
    nameUpper: 'GAME TEMPLATE',
    slug: 'gametemplate',
    npmName: 'toss-game-launchpad',
    display: '게임 템플릿',
}

function parseArgs() {
    const args = {}
    const argv = process.argv.slice(2)
    for (let i = 0; i < argv.length; i++) {
        const m = argv[i].match(/^--(\w+)$/)
        if (m) args[m[1]] = argv[++i]
    }
    return args
}

const args = parseArgs()
const { id, name, slug, display } = args
if (!id || !name || !slug || !display) {
    console.error('Usage: node scripts/new-game.js --id com.studio.mygame --name "MY GAME" --slug mygame --display "내 게임"')
    process.exit(1)
}
if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/.test(id)) {
    console.error(`Invalid --id "${id}" — expected reverse-DNS like com.studio.mygame`)
    process.exit(1)
}
if (!/^[a-z][a-z0-9]*$/.test(slug)) {
    console.error(`Invalid --slug "${slug}" — lowercase letters/digits only`)
    process.exit(1)
}

const ROOT = path.resolve(__dirname, '..')

/** Files that carry the hardcoded identity. */
const TARGETS = [
    'game.manifest.json',
    'package.json',
    'package-lock.json',
    'capacitor.config.ts',
    'granite.config.ts',
    '.granite/app.json',
    'index.html',
    'src/appConfig.ts',
    'src/i18n/translations.ts',
    'android/app/build.gradle',
    'android/app/src/main/res/values/strings.xml',
]

function replaceAll(text) {
    return text
        .split(OLD.id).join(id)
        .split(OLD.npmName).join(slug)
        .split(OLD.slug).join(slug)
        .split(OLD.nameUpper).join(name.toUpperCase())
        .split(OLD.name).join(name)
        .split(OLD.display).join(display)
}

let changed = 0
for (const rel of TARGETS) {
    const file = path.join(ROOT, rel)
    if (!fs.existsSync(file)) {
        console.warn(`skip (missing): ${rel}`)
        continue
    }
    const before = fs.readFileSync(file, 'utf-8')
    const after = replaceAll(before)
    if (after !== before) {
        fs.writeFileSync(file, after, 'utf-8')
        changed++
        console.log(`patched: ${rel}`)
    }
}

// ─── Move the Android MainActivity package directory ───
const javaRoot = path.join(ROOT, 'android/app/src/main/java')
const oldDir = path.join(javaRoot, ...OLD.id.split('.'))
const newDir = path.join(javaRoot, ...id.split('.'))
if (fs.existsSync(oldDir) && oldDir !== newDir) {
    fs.mkdirSync(newDir, { recursive: true })
    for (const f of fs.readdirSync(oldDir)) {
        const src = path.join(oldDir, f)
        const dst = path.join(newDir, f)
        const content = fs.readFileSync(src, 'utf-8')
        fs.writeFileSync(dst, content.split(OLD.id).join(id), 'utf-8')
        fs.unlinkSync(src)
    }
    // Remove now-empty old package directories up to java/
    let dir = oldDir
    while (dir !== javaRoot && fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
        fs.rmdirSync(dir)
        dir = path.dirname(dir)
    }
    console.log(`moved: MainActivity → ${path.relative(ROOT, newDir)}`)
}

// ─── Reset version ───
const pkgFile = path.join(ROOT, 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf-8'))
pkg.version = '0.0.1'
fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')

const lockFile = path.join(ROOT, 'package-lock.json')
if (fs.existsSync(lockFile)) {
    const lock = JSON.parse(fs.readFileSync(lockFile, 'utf-8'))
    lock.name = slug
    lock.version = '0.0.1'
    if (lock.packages?.['']) {
        lock.packages[''].name = slug
        lock.packages[''].version = '0.0.1'
    }
    fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n', 'utf-8')
}

const gradleFile = path.join(ROOT, 'android/app/build.gradle')
let gradle = fs.readFileSync(gradleFile, 'utf-8')
gradle = gradle
    .replace(/versionCode \d+/, 'versionCode 1')
    .replace(/versionName "[^"]+"/, 'versionName "0.0.1"')
fs.writeFileSync(gradleFile, gradle, 'utf-8')

console.log(`\nDone (${changed} files patched).`)
console.log('Next steps: see NEW_GAME.md — icons, ad ids, IAP SKUs, Toss console, keystore.')
