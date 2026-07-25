#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { platform } from 'node:os';
import { resolve } from 'node:path';

const isWin = platform() === 'win32';
const cwd = resolve(process.cwd(), 'android');
const cmd = isWin ? resolve(cwd, 'gradlew.bat') : './gradlew';
const args = process.argv.slice(2);

const result = spawnSync(cmd, args, {
  cwd,
  stdio: 'inherit',
  shell: isWin,
  env: { ...process.env, CAPACITOR_BUILD: 'true' },
});

process.exit(result.status ?? 1);
