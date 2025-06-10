#!/usr/bin/env node
import { existsSync } from 'fs';
import { join } from 'path';
import { execaSync } from 'execa';
// List of packages to install
const pkgs = [
  '@babel/parser',
  '@babel/traverse',
  '@babel/generator',
  '@babel/types'
];

// Ensure we're in a project with a package.json
const pkgJson = join(process.cwd(), 'package.json');
if (!existsSync(pkgJson)) {
  console.error('❌  No package.json found in current directory.');
  process.exit(1);
}

console.log('🔧 Installing devDependencies:', pkgs.join(', '));

// Run `npm install --save-dev ...`
const result = execaSync('npm', ['install', '--save-dev', ...pkgs], {
  stdio: 'inherit'
});

if (result.exitCode === 0) {
  console.log('🎉  All set! Your devDependencies are installed.');
} else {
  console.error('❌  Installation failed.');
  process.exit(result.exitCode);
}
