#!/usr/bin/env node
import { exec } from 'child_process';
import { promisify } from 'util';
import concurrently from 'concurrently';

import loadConfig from './loadConfig.js';
const config = (state.config = await loadConfig());

const execAsync = promisify(exec);

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index !== -1 && index + 1 < process.argv.length) {
    return process.argv[index + 1];
  }
  return null;
}

async function main() {
  try {
    // Read --config parameter or default
    const webpackConfig =
      getArgValue('--config') ||
      (config.teamGit &&
        `${config.teamGit}/${config.webpackConfig || 'webpack.config.js'}`) ||
      'webpack.config.js';

    await execAsync('npx dev');

    await concurrently(
      [
        { command: 'npx dev --watch', name: 'auto-scope' },
        {
          command: `NODE_ENV=development npx webpack --config ${webpackConfig} --watch -mode development`,
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
