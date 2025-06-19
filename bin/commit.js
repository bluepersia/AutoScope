#!/usr/bin/env node
import simpleGit from 'simple-git';
import loadConfig from './loadConfig.js';
import { isGitError } from '../shared.js';
const config = await loadConfig();
const myGit = simpleGit(process.cwd());
const teamGit = simpleGit(`${process.cwd()}/${config.teamGit}`);

let msg;
const args = process.argv.slice(2); // Skip first two elements (node and script path)

args.forEach((arg, index) => {
  if (arg === '-m' && args[index + 1]) {
    msg = args[index + 1];
  }
});

async function main() {
  await myGit.commit(msg);
  await teamGit.commit(msg);
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