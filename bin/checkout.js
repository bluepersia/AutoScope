#!/usr/bin/env node

import { isGitError } from '../shared.js';
import loadConfig from './loadConfig.js';
const config = await loadConfig();
import simpleGit from 'simple-git';
const myGit = simpleGit(process.cwd());
const teamGit = simpleGit(`${process.cwd()}/${config.teamGit}`);
const args = process.argv.slice(2); // Skip first two elements (node and script path)

let name = null;
let b = false;

args.forEach((arg, index) => {
  if (arg === '-b') {
    b = true;
  } else if (!name) {
    name = arg;
  }
});

if (!name) {
  throw new Error('Missing branch name.');
}

async function main() {
  if (b) {
    await myGit.checkoutLocalBranch(name);
    await teamGit.checkoutLocalBranch(name);
  } else {
    await myGit.checkout(name);
    await teamGit.checkout(name);
  }
}

try {
await main();
}catch(err)
{
  if (isGitError(err))
    console.error (err.message);
  else 
    console.error (err);
}