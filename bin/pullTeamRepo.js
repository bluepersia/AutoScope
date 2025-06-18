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
import { isGitError, state } from '../shared.js';
import { syncTeamRepo } from '../main/teamRepo.js';
import { default as inquirer } from 'inquirer';
import fsExtra from 'fs-extra';
import { globby } from 'globby';
import postcss from 'postcss';
import fs from 'fs/promises';
import fsDefault from 'fs';
import fg from 'fast-glob';
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

  if (!devMode && !name) {
    await build(state.config);
  }

  if (name)
    await readFilesUsing (name);

  setTimeout (async () => {
   
    //await gitAdd (myGit, state.config.outputDir);

    await myGit.rm (["-r", 'merge']);
    
    await gitAdd(myGit, state.config.inputDir);
    await myGit.commit('Commit final build');

    await myGit.checkout (`${currentBranch.my}-snapshot`);
    await fsExtra.remove ('merge');
    await myGit.rm (["-r", 'merge']);
    await myGit.commit ('Commit snapshot merge delete');
 
    await myGit.reset(['--hard', currentBranch.my]);
    await myGit.checkout (currentBranch.my);
  }, 1000);
}
catch(err)
{
  if (isGitError (err))
    console.error (err.message);
  else 
    console.error (err);
}
}

async function readFileSafe(filepath) {
  try {
    return await fs.readFile(filepath, 'utf8');
  } catch {
    return '';
  }
}

function parseCssScopeHashes(cssContent) {
  const results = [];

  const rules = cssContent.split('}');
  for (const rule of rules) {
    const parts = rule.split('{');
    if (parts.length < 2) continue;
    const selector = parts[0].trim();
    const body = parts[1].trim();

    const classMatches = [...selector.matchAll(/\.[a-zA-Z0-9_-]+/g)];
    if (classMatches.length === 0) continue;

    const hashMatch = body.match(/--scope-hash\s*:\s*([^;]+);?/);
    if (!hashMatch) continue;

    const hash = hashMatch[1].trim().split(' /*')[0];

    for (const m of classMatches) {
      const className = m[0].slice(1);
      results.push({ className, hash });
    }
  }

  return results;
}

function htmlUsesClass(htmlContent, className) {
  const regex = new RegExp(`class=["'][^"']*\\b${className}\\b[^"']*["']`, 'i');
  return regex.test(htmlContent);
}

async function main(isRetry = false) {
  const cwd = process.cwd();

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

  const allFilesBefore = await Promise.all(
    state.config.teamSrc.map(
      async (src) =>
        await fg(`${state.config.teamGit}/${src}/**/*`, {
          cwd,
          dot: true,
          onlyFiles: true,
        })
    )
  );

  const cssFiles = allFilesBefore
    .map((teamSrcFiles) => teamSrcFiles.filter((f) => f.endsWith('.css')))
    .flat();

  const scopeHashes = [];
  for (const cssFile of cssFiles) {
    const content = await readFileSafe(path.join(cwd, cssFile));
    const hashes = parseCssScopeHashes(content);
    scopeHashes.push(...hashes);
  }

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
    console.error('Git pull failed:', err);
   // await fsExtra.remove('merge');
    //await myGit.deleteLocalBranch('merge');
    return false;
  }

  async function readFilesAfter() {
    const allFilesAfter = await Promise.all(
      state.config.teamSrc.map(
        async (src) =>
          await fg(`${state.config.teamGit}/${src}/**/*`, {
            cwd,
            dot: true,
            onlyFiles: true,
          })
      )
    );

    const cssFilesAfter = allFilesAfter
      .map((teamSrcFiles) => teamSrcFiles.filter((f) => f.endsWith('.css')))
      .flat();

    const scopeHashesAfter = [];
    for (const cssFile of cssFilesAfter) {
      const content = await readFileSafe(path.join(cwd, cssFile));
      const hashes = parseCssScopeHashes(content);
      scopeHashesAfter.push(...hashes);
    }

    const afterHashArr = scopeHashesAfter.map((h) => h.hash);

    return { afterHashArr, allFilesAfter };
  }

  let after = await readFilesAfter();

  const hashesAdded = after.afterHashArr.filter(
    (h) => !scopeHashes.find((obj) => obj.hash === h)
  );

  //await gitAdd (myGit, 'merge');

  //await myGit.commit('Save master before returning');

  //await myGit.checkout(currentBranch.my);
  await teamGit.checkout(currentBranch.team);

  let myCssFiles;

  let collisionOccured = false;
  if (hashesAdded.length > 0) {
    myCssFiles = await globby(`${state.config.inputDir}/**/*.css`);

    for (const cssFile of myCssFiles) {
      const css = await fs.readFile(cssFile, 'utf-8');

      for (const hashAdded of hashesAdded) {
        if (
          css.includes(`--scope-hash:${hashAdded}`) ||
          css.includes(`--scope-hash: ${hashAdded}`)
        ) {
          collisionOccured = true;
          //console.warn (`Hash ${hashAdded} is already used. Resetting ${cssFile}.`)
          const root = postcss.parse(css, { from: cssFile });

          root.walkRules((rule) => {
            rule.walkDecls('--scope-hash', (decl) => {
              const next = decl.next();

              // Check if next node is a comment and on the same line
              if (
                next &&
                next.type === 'comment' &&
                next.source.start.line === decl.source.end.line
              ) {
                next.remove();
              }

              decl.remove();
            });
          });
          const out = await state.config.cssFormatter(root.toString());
          await fs.writeFile(cssFile, out, 'utf-8');
        }
      }
    }
  }

  if (collisionOccured) {
    //await fsExtra.remove('merge');
   // await myGit.deleteLocalBranch('merge');
    await await pull(devMode, true);
    return;
  }


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
  await build(state.config, null, false, false);
  state.config.outputDir = state.config.initOutputDir;
  await gitAdd (myGit, 'merge');
  await myGit.commit('Commit snapshot build.');
  
  after = await readFilesAfter();

  const beforeHashMap = new Map(scopeHashes.map((h) => [h.hash, h])); // map hash -> object
  const filesDeleted = allFilesBefore
    .map((teamSrc, index) =>
      teamSrc.filter(
        (f) => !f.endsWith('.css') && !after.allFilesAfter[index].includes(f)
      )
    )
    .map((teamSrc, index) =>
      teamSrc.map((p) =>
        path.join(
          config.inputDir,
          path.relative(
            state.config.teamSrc.length <= 1
              ? `${state.config.teamGit}/${state.config.teamSrc[index]}`
              : state.config.teamGit,
            p
          )
        )
      )
    )
    .flat()
    .filter((filePath) => {  
      return fsDefault.existsSync(filePath)
});

  const hashDeleted = [...beforeHashMap.entries()]
    .filter(([hash]) => !after.afterHashArr.includes(hash))
    .map(([hash, { className }]) => ({
      hash,
      scopeName: className.replace(/-\w+$/, ''),
    }));

  if (filesDeleted.length > 0) {
    console.log('\nThe following files no longer exist in the repo:\n');
    filesDeleted.forEach((file) => console.log('  -', file));
    const { confirmDelete } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmDelete',
        message:
          'Do you want to delete these files from your source directory?',
        default: false,
      },
    ]);

    if (confirmDelete) {
      for (const fileRel of filesDeleted) {
        try {
          await fs.unlink(fileRel);
          console.log(`Deleted file: ${fileRel}`);
        } catch (err) {
          console.warn(`Failed to delete ${fileRel}: ${err.message}`);
        }
      }
      await myGit.add (filesDeleted);
    }
  }

  if (hashDeleted.length > 0) {
    if (!myCssFiles) myCssFiles = await globby(`${state.config.inputDir}/**/*.css`);

    const deletedFiles = [];

    for (const { hash } of hashDeleted) {
      for (const srcPath of myCssFiles) {
        const content = await fs.readFile(srcPath, 'utf8');
        if (
          content.includes(`--scope-hash: ${hash}`) ||
          content.includes(`--scope-hash:${hash}`)
        ) {
          deletedFiles.push(srcPath);
          break;
        }
      }
    }

    if (deletedFiles.length > 0) {
      console.log(
        '\nThe following files in your source have become invalidated (either through deletion or hash removal in the repo):\n'
      );

      deletedFiles.forEach((file) => console.log('  -', file));
      const { confirmDelete } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmDelete',
          message:
            'Do you want to delete these files from your source directory?',
          default: false,
        },
      ]);

      if (confirmDelete) {
        for (const deletedFile of deletedFiles) {
          try {
            await fs.unlink(deletedFile);
          } finally {
          }
        }
        await myGit.add (deletedFiles);
      }
    }
  }
  await myGit.commit ('Commit any deleted content');
  await myGit.checkout (currentBranch.my);
  await myGit.mergeFromTo(`${currentBranch.my}-snapshot`, currentBranch.my);
  state.config.outputDir = 'merge';
  await build(state.config, null, false, false);
  state.config.outputDir = state.config.initOutputDir;
  await gitAdd (myGit, 'merge');
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
  return { filesDeleted, hashDeleted };
}
