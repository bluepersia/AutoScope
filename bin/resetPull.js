#!/usr/bin/env node
import simpleGit from 'simple-git';

import loadConfig from './loadConfig.js';
const config = await loadConfig();
const myGit = simpleGit(process.cwd());
const teamGit = simpleGit(`${process.cwd()}/${config.teamGit}`);

async function main() {
  const currentBranchTeam = (await teamGit.revparse(['--abbrev-ref', 'HEAD'])).trim();
  const currentBranchMy = (await myGit.revparse(['--abbrev-ref', 'HEAD'])).trim();
  if (currentBranchMy === 'master' || currentBranchTeam === 'master')
    throw Error(
      'You are on the master branch! To do a pull backup, you must be on the branch where you initiated the pull'
    );

  await myGit.reset(['--hard', 'pull-backup']);
  await teamGit.reset(['--hard', 'pull-backup']);
  await teamGit.checkout('master');
  await teamGit.reset(['--hard', 'pull-backup']);
  await teamGit.checkout(currentBranchTeam);
}

main();
