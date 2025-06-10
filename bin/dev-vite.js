#!/usr/bin/env node

import { promisify } from 'util';
import { exec } from 'child_process';

import concurrently from 'concurrently';

const run = promisify(exec);

async function main() {
  try {
    await run('npx build --noJS');

    await concurrently(
      [
        { command: 'npx dev --noJS', name: 'auto-scope' },
        { command: 'npx vite' },
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
