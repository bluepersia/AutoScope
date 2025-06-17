#!/usr/bin/env node

import { promisify } from 'util';
import { exec } from 'child_process';
import loadConfig from './loadConfig.js';
const config = (state.config = await loadConfig());

import concurrently from 'concurrently';

const run = promisify(exec);

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index !== -1 && index + 1 < process.argv.length) {
    return process.argv[index + 1];
  }
  return null;
}

async function main() {
  try {
    const webpackConfig =
      getArgValue('--config') ||
      (config.teamGit &&
        `${config.teamGit}/${config.webpackConfig || 'webpack.config.js'}`) ||
      'webpack.config.js';

    await run('npx sass src/scss:src/css -no-source-map');

    await run('npx dev');

    await concurrently(
      [
        { command: 'npx sass src/scss:src/css --watch', name: 'scss' },
        { command: 'npx dev --watch', name: 'auto-scope' },
        {
          command: `NODE_ENV=development npx webpack --config ${webpackConfig} --watch --mode development`,
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
