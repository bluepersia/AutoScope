#!/usr/bin/env node

import { promisify } from 'util';
import { exec } from 'child_process';

import loadConfig from './loadConfig.js';
const config = (state.config = await loadConfig());

import concurrently from 'concurrently';

const run = promisify(exec);

async function main() {
  try {
    await run('npx sass src/scss:src/css -no-source-map');

    await run('npx dev');

    await concurrently(
      [
        { command: 'npx sass src/scss:src/css --watch', name: 'scss' },
        { command: 'npx dev --watch', name: 'auto-scope' },
        {
          command: `npx vite --root dev-temp --config ${
            config.teamGit
              ? `${config.teamGit}/${config.viteConfig || 'vite.config.js'}`
              : 'vite.config.js'
          }`,
        },
      ],
      {
        prefix: 'name',
        killOthers: ['failure', 'success'],
      }
    )
      .then(() => {
        console.log('All processes exited');
      })
      .catch((err) => {
        console.error('At least one process failed', err);
      });
  } catch (err) {
    console.error('❌ Build failed:', err.stderr || err);
    process.exit(1);
  }
}

main();
