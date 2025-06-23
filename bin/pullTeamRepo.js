#!/usr/bin/env node
import path from 'path';
import {
  initInputCss,
  initInputHtml,
  initCombinatorFlattening,
  initInputReact,
  initTeamRepoHashMap,
  initFormatters,
  initTeamSrc,
  checkDevMode,
  build,
} from '../index.js';
import { isGitError, state, renameFile, getPrePullState, readFilesAfter, handleFilesDeleted, handleHashesDeleted, readHashesCollided } from '../shared.js';
import { readTeamIDs, syncTeamRepo } from '../main/teamRepo.js';
import { default as inquirer } from 'inquirer';
import fsExtra from 'fs-extra';
import { globby } from 'globby';
import postcss from 'postcss';
import fs from 'fs/promises';
import simpleGit from 'simple-git';
import loadConfig from './loadConfig.js';
import {readFilesUsing} from './where.js';

const config = (state.config = await loadConfig());
const myGit = simpleGit(process.cwd());
const teamGit = simpleGit(`${process.cwd()}/${config.teamGit}`);

async function tagExists(git, tagName) {
  const tags = await git.tags(); // returns { all: [...], latest: '...' }
  return tags.all.includes(tagName);
}

async function gitAdd (git, dir)
{
  const files = await globby([ `${dir}/**/*`]);

  try{
    await git.add(files);
  }
  catch(err)
  {
    console.log (err);
  }
}
async function copyTeamToMergeFolder ()
{
  if(state.config.teamSrc.length <= 1)
    await fsExtra.copy(`${state.config.teamGit}/${state.config.teamSrc[0]}`, 'merge', {
      preserveTimestamps:true,
      filter: (srcPath) => !srcPath.includes('.git')
    });
  else 
  {
    for (const src of state.config.teamSrc)
      await fsExtra.copy (`${state.config.teamGit}/${src}`, `merge/${src}`, {
      preserveTimestamps:true,
        filter: (srcPath) => !srcPath.includes('.git')
      });
  }
}

const currentBranch = {};

const args = process.argv.slice(2); // Skip first two elements (node and script path)

let name;

args.forEach((arg, index) => {
  if (arg === '--name' && args[index + 1]) {
    name = args[index + 1];
  }
});

await initCombinatorFlattening(config);
await initFormatters();
initTeamSrc();
state.config.initOutputDir = state.config.outputDir;

state.config.initUsePrettier = state.config.usePrettier;

checkDevMode(pull);

let devMode;

async function formatMergeFiles() {
  return;
  const mergeHtmlFiles = await globby('merge/**/*.html');
  const mergeCssFiles = await globby('merge/**/*.css');
  const mergeReactFiles = await globby(['merge/**/*.jsx', 'merge/**/*.tsx']);

  for (const htmlFile of mergeHtmlFiles) {
    const html = await fs.readFile(htmlFile, 'utf-8');
    const out = await state.htmlFormatter(html);
    await fs.writeFile(htmlFile, out);
  }
  for (const cssFile of mergeCssFiles) {
    const css = await fs.readFile(cssFile, 'utf-8');
    const out = await state.cssFormatter(css);
    await fs.writeFile(cssFile, out);
  }
  for (const reactFile of mergeReactFiles) {
    const react = await fs.readFile(reactFile, 'utf-8');
    const out = reactFile.endsWith('.jsx')
      ? await state.jsFormatter(react)
      : await state.tsFormatter(react);
    await fs.writeFile(reactFile, out);
  }
}
async function pull(devMd = false, isRetry = false) {
  try {
  devMode = devMd;

  
  if (!(await main(isRetry))) return;
  await syncTeamRepo(state.config, (name && [name]) || [], null, 'merge');


  await fsExtra.remove('merge');

 /* if (!devMode && !name) {
    await build(state.config);
  }*/

  if (name)
    await readFilesUsing (name);

  setTimeout (async () => {
   
    //await gitAdd (myGit, state.config.outputDir);

    await myGit.rm (["-r", 'merge']);
    
    await gitAdd(myGit, state.config.inputDir);
    await myGit.commit('Commit final build');

    await myGit.checkout (`${currentBranch.my}-snapshot`);
 
    await myGit.reset(['--hard', currentBranch.my]);
    await myGit.checkout (currentBranch.my);

    await readHashesCollided ();
  }, 1000);
}
catch(err)
{
  if (isGitError (err))
    console.error (err.message);
  else if (err.message !== 'Cancelled.')
    console.error (err);
  else 
    console.log (err.message);


  await myGit.checkout (currentBranch.my);
  await fsExtra.remove('merge');
  try{
    await myGit.rm (["-r", 'merge']);
  }catch(err) {}
  await myGit.commit('Removed merge folder');
  await myGit.checkout (`${currentBranch.my}-snapshot`);
  await fsExtra.remove ('merge');
  try{
    await myGit.rm (["-r", 'merge']);
  }catch(err) {}
  await myGit.commit ('Commit snapshot merge delete');
  await myGit.checkout (currentBranch.my);
}
}


function htmlUsesClass(htmlContent, className) {
  const regex = new RegExp(`class=["'][^"']*\\b${className}\\b[^"']*["']`, 'i');
  return regex.test(htmlContent);
}

async function main(isRetry = false) {
  

  const inputDir = state.config.inputDir;
  if (!inputDir) {
    console.error('Usage: node sync-check.js <inputDir>');
    process.exit(1);
  }

  currentBranch.my = (await myGit.revparse(['--abbrev-ref', 'HEAD'])).trim();
  currentBranch.team = (await teamGit.revparse(['--abbrev-ref', 'HEAD'])).trim();

  if (currentBranch.my === 'master' || currentBranch.team === 'master')
    throw Error(
      'You are on the master branch! To do a dev-pull, you must be on a different branch for merging.'
    );

  const {allFilesBefore, scopeHashes} = await getPrePullState ();

  await myGit.add('.');
  await teamGit.add('.');
  await myGit.commit('Save WIP before master backup');
  await teamGit.commit('Save WIP before pulling master');

  await teamGit.checkout('master');

  //Backupteam
  await teamGit.add('.');
  if (!isRetry) {
    await teamGit.commit('Pre-pull backup');;
    if (await tagExists (teamGit, 'pull-backup'))
      await teamGit.tag(['-d', 'pull-backup']);
    if (await tagExists (myGit, 'pull-backup'))
      await myGit.tag(['-d', 'pull-backup']);
    await teamGit.tag(['pull-backup']);
    await myGit.tag(['pull-backup']);
  }

  /*
  for (const teamSrc of state.config.teamSrc) {
    await fsExtra.copy(
      `${state.config.teamGit}/${teamSrc}`,
      state.config.teamSrc.length <= 1 ? 'merge' : `merge/${teamSrc}`,
      {
        filter: (src) => {
          const rel = path.relative(
            state.config.teamSrc.length <= 1
              ? `${state.config.teamGit}/${teamSrc}`
              : state.config.teamGit,
            src
          );
          return !rel.startsWith('.git'); // skip .git and anything inside
        },
      }
    );
  }*/
   // await copyTeamToMergeFolder ();
 // await formatMergeFiles();

  try {
    await teamGit.pull('origin', 'master');
  } catch (err) {
    err.stack = '';
    console.error('Git pull failed:', err);
    const { confirmMerge } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmMerge',
        message:
          'Is the merge completed?',
        default: false,
      },
    ]);

    if (!confirmMerge) {
    throw Error ('Cancelled.');
  }

  teamGit.add ('.');
  teamGit.commit ('Pull merge completed.');
}

  

  //let after = await readFilesAfter();

  //await gitAdd (myGit, 'merge');

  //await myGit.commit('Save master before returning');

  //await myGit.checkout(currentBranch.my);




  const after = await readFilesAfter();
  const hashesAdded = after.afterHashArr.filter(
    (h) => !scopeHashes.find((obj) => obj.hash === h.hash)
  );

  const collisionsOccured = [];
  let myCssFiles;

  if (hashesAdded.length > 0) {
    myCssFiles = await globby(`${state.config.inputDir}/**/*.css`);

    for (const cssFile of myCssFiles) {
      const css = await fs.readFile(cssFile, 'utf-8');
      const baseClass = path.basename (cssFile, '.css');

      for (const hashAdded of hashesAdded) {
        if (
          (css.includes(`--scope-hash:${hashAdded.hash}`) ||
          css.includes(`--scope-hash: ${hashAdded.hash}`)) 
        ) {
          collisionsOccured.push (cssFile);
        }
      }
    }
  }

  if (collisionsOccured.length > 0) {
    //await fsExtra.remove('merge');
   // await myGit.deleteLocalBranch('merge');
    await readTeamIDs ();
    
    for(const cssFile of collisionsOccured)
    {
      const root = postcss.parse(css, { from: cssFile });

      root.walkRules((rule) => {
        rule.walkDecls('--scope-hash', (decl) => {
          const newDecl = postcss.decl({
            prop: '--resolve-collision',
            value: true,
          });

          rule.append(newDecl);
        });
      });
      const out = await state.cssFormatter(root.toString());
      await fs.writeFile(cssFile, out, 'utf-8');
    }
  }

  await teamGit.checkout(currentBranch.team);

  try {
    await teamGit.mergeFromTo('master', currentBranch.team);
  } catch (e) {
    console.warn('Team repo merge conflicts detected. Please resolve them.');

    const { commitMsg } = await inquirer.prompt([
      {
        type: 'input',
        name: 'commitMsg',
        message: 'Post-merge commit message:'
      },
    ]);


    await teamGit.add('.');
    await teamGit.commit(commitMsg || 'Resolve merge conflicts');
  }

  await initTeamRepoHashMap();

  await myGit.checkout (`${currentBranch.my}-snapshot`);
  state.config.outputDir = 'merge';
  state.preserveCollidingSuffixes = true;
  await build(state.config, null, false, false);
  state.config.outputDir = state.config.initOutputDir;
  await gitAdd (myGit, 'merge');
  await myGit.commit('Commit snapshot build.');
  
  

 // const beforeHashMap = new Map(scopeHashes.map((h) => [h.hash, h])); // map hash -> object
  await handleFilesDeleted (myGit, allFilesBefore,  after.allFilesAfter);

  await myGit.commit ('Commit any deleted content');
  await myGit.checkout (currentBranch.my);
  try {
    await myGit.mergeFromTo(`${currentBranch.my}-snapshot`, currentBranch.my);
  }catch(e)
  {
    if (e.message.includes('CONFLICTS')) {
      // Get status to find conflicted files
      const status = await myGit.status();
      for (const file of status.conflicted) {
        // Checkout 'theirs' version for conflicted file
        await myGit.raw(['checkout', '--theirs', file]);
        await myGit.add(file);
      }
      await myGit.commit('Auto-resolve merge conflicts by taking theirs');
    } else {
      throw e; // rethrow other errors
    }
  }
  state.config.outputDir = 'merge';
  await build(state.config, null, false, false);
  state.config.outputDir = state.config.initOutputDir;
  state.preserveCollidingSuffixes = false;
  await gitAdd (myGit, 'merge');

  
  await handleHashesDeleted (myGit, scopeHashes, after.afterHashArr);

  await myGit.commit('Commit build.');

  await myGit.checkout(`${currentBranch.my}-snapshot`);
  await copyTeamToMergeFolder ();

  await formatMergeFiles();

  await gitAdd (myGit, 'merge');
  await myGit.commit('Commit snapshot progression');

  await myGit.checkout(currentBranch.my);

  try {
    await myGit.mergeFromTo(`${currentBranch.my}-snapshot`, currentBranch.my);
  } catch (e) {
    console.warn(
      'Merge conflicts in build detected. Resolve them in the merge folder.'
    );

    const { confirmMerge } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmMerge',
        message: 'Has the merge been resolved?',
        default: false,
      },
    ]);

    if (!confirmMerge) return;

    await gitAdd (myGit, 'merge');
    await myGit.commit('Resolve merge conflicts');
  }

  /*
  const htmlDeleted = [];
  for (const htmlFile of htmlUsingHash) {
    const contentAfter = await readFileSafe(path.join(cwd, htmlFile));

    // A) Does it still use _any_ of the original classes?
    let stillUsesAny = false;
    for (const { className } of scopeHashes) {
      if (htmlUsesClass(contentAfter, className)) {
        stillUsesAny = true;
        break;
      }
    }
    if (!stillUsesAny) {
      // never uses any scoped class any more
      htmlDeleted.push(htmlFile);
      continue;
    }

    // B) Even if it still uses some classes, does it use one whose hash was deleted?
    //    (i.e. className was in scopeHashes, but its hash is in hashDeleted)
    let usesRemovedHash = false;
    for (const { className, hash } of scopeHashes) {
      if (hashDeleted.includes(hash) && htmlUsesClass(contentAfter, className)) {
        usesRemovedHash = true;
        break;
      }
    }
    if (usesRemovedHash) {
      htmlDeleted.push(htmlFile);
    }
  }
*/
  return true;
}


async function renameFileTo (file, to)
{
  
}
