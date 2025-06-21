#!/usr/bin/env node

import loadConfig from './loadConfig.js';
let config = await loadConfig();
import simpleGit from 'simple-git';
import {state, isGitError} from '../shared.js';
import {init} from '../index.js';
import {syncTeamRepo} from "../main/teamRepo.js";
import { globby } from 'globby';
import fs from 'fs';
import postcss from 'postcss';
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
config = await init(config,null, false, true);


async function main() {
    const initBranch = {my: (await myGit.revparse(['--abbrev-ref', 'HEAD'])).trim(), team:(await teamGit.revparse(['--abbrev-ref', 'HEAD'])).trim() };

    try{
        await myGit.push ('origin', initBranch.my);
    }catch(err)
    {
        
    }

    await teamGit.push ('origin', initBranch.team);

   
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