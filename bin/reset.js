#!/usr/bin/env node
import { isGitError } from '../shared.js';
import simpleGit from 'simple-git';
import loadConfig from './loadConfig.js';
const config = await loadConfig();
const myGit = simpleGit(process.cwd());
const teamGit = simpleGit(`${process.cwd()}/${config.teamGit}`);

let hard;
const args = process.argv.slice(2); // Skip first two elements (node and script path)


args.forEach((arg, index) => {
  if (arg === '--hard' && args[index + 1]) {
    hard = args[index + 1];
  }
});

const resetArr = hard ? ['--hard', 'HEAD~1'] : ['HEAD~1']

async function main() {
  await myGit.reset(resetArr);
  await teamGit.reset(resetArr);
}

try {
await main();
}catch(err)
{
  if (isGitError (err))
    console.error (err.message);
  else 
    console.error (err);
}