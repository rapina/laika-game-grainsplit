#!/usr/bin/env node

/**
 * Auto version bump script
 * - package.json version: patch increment (0.1.0 → 0.1.1)
 * - versionCode: +1 per build
 * - versionName: synced with package.json
 */

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const buildGradlePath = join(rootDir, 'android/app/build.gradle');
const packageJsonPath = join(rootDir, 'package.json');

// Read and bump package.json version
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const currentVersion = packageJson.version;

const versionParts = currentVersion.split('.');
versionParts[2] = parseInt(versionParts[2], 10) + 1;
const newVersion = versionParts.join('.');

packageJson.version = newVersion;
writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');

// Read build.gradle
let buildGradle = readFileSync(buildGradlePath, 'utf8');

// Extract current versionCode
const versionCodeMatch = buildGradle.match(/versionCode\s+(\d+)/);
if (!versionCodeMatch) {
    console.error('versionCode not found in build.gradle');
    process.exit(1);
}

const currentVersionCode = parseInt(versionCodeMatch[1], 10);
const newVersionCode = currentVersionCode + 1;

// Update versionCode
buildGradle = buildGradle.replace(
    /versionCode\s+\d+/,
    `versionCode ${newVersionCode}`
);

// Update versionName
buildGradle = buildGradle.replace(
    /versionName\s+"[^"]+"/,
    `versionName "${newVersion}"`
);

writeFileSync(buildGradlePath, buildGradle);

console.log(`Version bumped:`);
console.log(`  package.json: ${currentVersion} → ${newVersion}`);
console.log(`  versionCode: ${currentVersionCode} → ${newVersionCode}`);
console.log(`  versionName: "${newVersion}"`);
