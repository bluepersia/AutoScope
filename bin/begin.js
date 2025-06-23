#!/usr/bin/env node

import loadConfig from './loadConfig.js';
let config = await loadConfig();
import simpleGit from 'simple-git';
import {state, isGitError, getPrePullState, readFilesAfter, handleFilesDeleted, handleHashesDeleted, readHashesCollided} from '../shared.js';
import {init} from '../index.js';
import {readTeamIDs, syncTeamRepo} from "../main/teamRepo.js";
import { globby } from 'globby';
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

async function gitAdd (git, dir)
{
  const files = await globby([ `${dir}/**/*`]);
  await git.add(files);
}
async function remoteOriginExists() {
  const remotes = await myGit.getRemotes(true); // true = include URLs
  return remotes.some(remote => remote.name === 'origin');
}

async function main() {

    await myGit.checkout ('master');
    try {
      await myGit.pull ('origin', 'master');
    }catch(err) {}
    
    await teamGit.checkout ('master');

    const {scopeHashes, allFilesBefore} = await getPrePullState ();
    
    await teamGit.pull ('origin', 'master');
    await myGit.checkoutLocalBranch(name);

    const {allFilesAfter, afterHashArr} = await readFilesAfter(scopeHashes);

    await handleFilesDeleted (myGit, allFilesBefore, allFilesAfter);
    await handleHashesDeleted (myGit, scopeHashes, afterHashArr);

    try {
      await syncTeamRepo(config);
    }catch(err)
    {
      console.error (err);

      myGit.checkout ('master');
      myGit.deleteLocalBranch (name);
      return;
    }
    await gitAdd (myGit, state.config.inputDir)
    await myGit.commit ('Team sync');
    
    if(((await myGit.branch ()).all.includes (`${name}-snapshot`)))
        await myGit.branch (['-D', `${name}-snapshot`]);

    await myGit.checkoutLocalBranch (`${name}-snapshot`);
    await teamGit.checkoutLocalBranch(name);
    await myGit.checkout (name);
 
    state.preserveCollidingSuffixes = true;
    await readTeamIDs ();
    await readHashesCollided ();
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