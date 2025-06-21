#!/usr/bin/env node

import loadConfig from './loadConfig.js';
let config = await loadConfig();
import simpleGit from 'simple-git';
import {state, isGitError} from '../shared.js';
import {syncTeamRepo} from "../main/teamRepo.js";
const myGit = simpleGit(process.cwd());
const teamGit = simpleGit(`${process.cwd()}/${config.teamGit}`);
const args = process.argv.slice(2); // Skip first two elements (node and script path)

let from = null;
let to = null;
args.forEach((arg, index) => {
  if (arg === '--from' && args[index + 1]) {
    from = args[index + 1];
  } else if (arg === '--to' && args[index + 1])
    to = args[index + 1];
});

if (!from) {
  throw new Error('Missing --from');
}
if (!to)
{
  throw new Error ('Missing --to')
}
async function main() {

    await myGit.checkout (`${to}-snapshot`);
    try {
        await myGit.mergeFromTo (from, `${to}-snapshot`);
    }catch(err)
    {
        console.error (err);
    }
    await myGit.checkout (to);
    await teamGit.checkout (to);

    try{
        await myGit.mergeFromTo (from, to);
    }catch(err)
    {
        console.error (err);
    }
    try{
        await teamGit.mergeFromTo (from, to);
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