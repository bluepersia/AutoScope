#!/usr/bin/env node
import { isGitError } from '../shared.js';
import loadConfig from './loadConfig.js';
const config = await loadConfig();
import simpleGit from 'simple-git';
const myGit = simpleGit(process.cwd());
const teamGit = simpleGit(`${process.cwd()}/${config.teamGit}`);
const args = process.argv.slice(2); // Skip first two elements (node and script path)

let name;
let force;

args.forEach((arg, index) => {
  if (arg === '-d' && args[index + 1]) {
    name = args[index + 1];
  } else if (arg === '-D' && args[index + 1])
  {
    name = args[index + 1];
    force = true;
  }
});

async function main() {
  if (force)
  {
  await myGit.branch(['-D', name]);
  await teamGit.branch(['-D', name]);
  }
  else 
  {
    await myGit.deleteLocalBranch(name);
  await teamGit.deleteLocalBranch(name);
  }
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