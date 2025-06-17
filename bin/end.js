#!/usr/bin/env node
import simpleGit from 'simple-git';
import loadConfig from './loadConfig.js';
let config = await loadConfig();

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
async function remoteOriginExists() {
    const remotes = await myGit.getRemotes(true); // true = include URLs
    return remotes.some(remote => remote.name === 'origin');
  }
  

async function main() {

    await myGit.checkout ('master');
    await teamGit.checkout ('master');
    
    try {
    await myGit.pull ('origin', 'master');
    }
    catch(err)
    {
      if((await myGit.branch ()).all.includes (name))
      await myGit.mergeFromTo (name, 'master');
    }
    await teamGit.pull ('origin', 'master');

    if ((await myGit.branch ()).all.includes (name))
      await myGit.deleteLocalBranch (name);

    if((await teamGit.branch ()).all.includes (name))
      await teamGit.deleteLocalBranch (name);

    if(((await myGit.branch ()).all.includes (`${name}-snapshot`)))
        await myGit.branch (['-D', `${name}-snapshot`]);
}

main();
