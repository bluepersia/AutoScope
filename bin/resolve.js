#!/usr/bin/env node
import path from 'path';
import { build, init}  from 'auto-scope/build';
import {syncTeamRepo, readTeamIDs} from '../main/teamRepo.cjs';
import {writeCssAndHtml} from '../main/conversion.js';
import fsExtra from 'fs-extra';
import simpleGit from "simple-git";
const git = simpleGit();
import globby from 'globby';
import {default as inquirer} from 'inquirer';
import loadConfig from './loadConfig.js';

const args = process.argv.slice(2); // Skip first two elements (node and script path)

let name;

args.forEach((arg, index) => {
  if (arg === '--name' && args[index + 1]) {
    name = args[index + 1];
  }
});

if (!name) {
  console.error('Please provide a name using --name <value>');
  process.exit(1);
}


const config = await loadConfig ();

config.initOutputDir = config.outputDir;
config.outputDir = 'merge';

 const currentBranch = (await git.revparse(["--abbrev-ref", "HEAD"])).trim();

 if(currentBranch === 'master')
  throw Error ('You are on master. You must be on a different branch to resolve and merge into it.');

 
  // if(fsExtra.existsSync ('dev-temp'))
    // await fsExtra.move ('dev-temp', config.teamRepo, {overwrite:true});
 
  await git.add ('.');
  await git.commit ('Commit resolution branch');
  
  await git.checkout("master");

   await git.pull("origin", "master");

   await git.add ('.');
   await git.commit ('Commit master');

    await git.checkout(currentBranch);

   try {
     await git.merge(["master"]);
   } catch (e) {
     console.warn("Merge conflict detected. Please resolve manually.");
     const { confirmMerge } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmMerge',
        message:
          'Has the merge been resolved?',
        default: false,
      },
    ]);

    if (!confirmMerge)
      return;
   }

   await init (config);

   await readTeamIDs ();



   await writeCssAndHtml ()
   await syncTeamRepo (config, null, [name]);


  // await build (config);
