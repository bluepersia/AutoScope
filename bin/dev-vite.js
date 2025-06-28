#!/usr/bin/env node

import { promisify } from 'util';
import { spawn } from 'child_process';
import devPath from './devPath.js';
import waitOnPath from './waitOnPath.js';

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: 'inherit', ...options });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Process exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

import {state} from '../shared.js';

import loadConfig from './loadConfig.js';
const config = (state.config = await loadConfig());

import concurrently from 'concurrently';
async function main() {
  try {
    //await runCommand('npx', ['dev-init']);

    const { result} = concurrently(
      [
        { command: 'npx dev', name: 'auto-scope', prefixColor:'magenta' },
        {
          command: `"${waitOnPath}" tcp:3012 && npx vite dev-temp --config ${
            config.teamGit
              ? `${config.teamGit}/${config.viteConfig || 'vite.config.js'}`
              : 'vite.config.js'
          }`,
          name:'vite',
          prefixColor: 'cyan'
        },
      ],
      {
        prefix: 'name',
        killOthersOn: ['failure', 'success'],
      }
    );

    result
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
