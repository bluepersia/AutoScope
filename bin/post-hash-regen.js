#!/usr/bin/env node

import loadConfig from './loadConfig.js';
let config = await loadConfig();
import simpleGit from 'simple-git';
import {state, isGitError} from '../shared.js';
import {syncTeamRepo} from "../main/teamRepo.js";
const myGit = simpleGit(process.cwd());
const teamGit = simpleGit(`${process.cwd()}/${config.teamGit}`);
const args = process.argv.slice(2); // Skip first two elements (node and script path)

let name = null;

args.forEach((arg) => {
 if (!name) {
    name = arg;
  }
});

if (!name) {
  throw new Error('Missing branch name.');
}
async function main() {

    await myGit.checkout (`${name}-snapshot`);
    try {
        await myGit.mergeFromTo ('master', `${name}-snapshot`);
    }catch(err)
    {
        console.error (err);
    }
    await myGit.checkout (name);
    await teamGit.checkout (name);

    try{
        await myGit.mergeFromTo ('master', name);
    }catch(err)
    {
        console.error (err);
    }
    try{
        await teamGit.mergeFromTo ('master', name);
    }catch(err)
    {
        console.error (err);
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