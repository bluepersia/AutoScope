#!/usr/bin/env node
import loadConfig from './loadConfig.js';
let config = await loadConfig();

import simpleGit from 'simple-git';
import { build } from '../index.js';
import postcss from 'postcss';
import { globby } from 'globby';
import fs from 'fs/promises'
import fsExtra from 'fs-extra';
import {default as inquirer} from 'inquirer';
import {writeFile} from '../shared.js';

const myGit = simpleGit(process.cwd());
const teamGit = simpleGit(`${process.cwd()}/${config.teamGit}`);
const args = process.argv.slice(2); // Skip first two elements (node and script path)

let hash = null;

args.forEach((arg) => {
 if (!hash) {
    hash = arg;
  }
});

if (!hash) {
  throw new Error('Missing hash.');
}
let targetCssFile;
const hashOccurences = {};

  const initBranch = {my: (await myGit.revparse(['--abbrev-ref', 'HEAD'])).trim(), team:(await teamGit.revparse(['--abbrev-ref', 'HEAD'])).trim() };

async function main ()
{
  /*
  await myGit.checkout ('master');

  try {
    await myGit.pull ('origin', 'master');
  }catch(err) {}

  await teamGit.checkout ('master');

  await teamGit.pull ('origin', 'master');

  if(!((await myGit.branch ()).all.includes (`hash-resolution`)))
    await myGit.checkoutLocalBranch ('hash-resolution');
  
  if(!((await teamGit.branch ()).all.includes (`hash-resolution`)))
    await teamGit.checkoutLocalBranch ('hash-resolution');

  await myGit.checkout ('hash-resolution');
  await teamGit.checkout ("hash-resolution");

  await commitAllHashes ();

  await myGit.mergeFromTo ('master', 'hash-resolution');

  try{
    await teamGit.mergeFromTo ('master', 'hash-resolution');
  }catch(err)
    {
      console.error(err);
      const { confirmMerge } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmMerge',
          message:
            'Remote hash changes detected. Perhaps it was moved to a different location. Update the new location, then proceed.',
          default: false,
        },
      ]);

      if (!confirmMerge)
        throw Error ('Cancelled.');
    }
*/
    const cssFiles = await globby (`${config.inputDir}/**/*.css`);
   
    for(const cssFile of cssFiles)
    {
        const css = await fs.readFile (cssFile, 'utf-8');

        if (css.includes (`--scope-hash:${hash}`) || css.includes (`--scope-hash: ${hash}`))
        {
            const result = await postcss([
                async (root) => {

                   root.walkDecls ('--scope-hash', decl =>
                   {
                        const comment = decl.next();
                        if(comment?.type === 'comment')
                            comment.remove ();
                        
                        decl.remove ();
                    }
                   ) 
                    
                }]).process (css, {from:undefined});

                await writeFile (cssFile, result.css);
                //await fs.writeFile (cssFile, result.css);
                targetCssFile = cssFile;
                break;
        }
    }
    if(!targetCssFile)
        throw Error ('Hash not found!');

    await myGit.add (targetCssFile);
    await myGit.commit ('Hash stripped');
    try {
        const res = await fetch('http://localhost:3012/check');

        config.outputDir = 'temp-hash-res';
        await build (config, null, false, true);
        await fsExtra.remove ('temp-hash-res');
        /*
        await updateSnapshot ();
        await updateDeps ();*/
    }catch(err)
    {
      /*
        await waitForHashGeneration ();
       await updateSnapshot ();
       await updateDeps ();*/
    }
}

function waitForHashGeneration(checkInterval = 100) {
    return new Promise((resolve) => {
      const interval = setInterval(async () => {
        const css = await fs.readFile (targetCssFile, 'utf-8');
        if (css.includes ('--scope-hash')) {
          clearInterval(interval);
          resolve();
        }
      }, checkInterval);
    });
  }

async function updateSnapshot ()
{


    const css = await fs.readFile (targetCssFile, 'utf-8');

    let newHash;
    await postcss([
        async (root) => {

            root.walkDecls('--scope-hash', decl =>
            {
                newHash = decl.value;
            }
            )
        }
    ]).process (css, {from:undefined});


    await myGit.checkout(`${currentBranch}-snapshot`);

    const snapCss = await fs.readFile (targetCssFile);

    const result = await postcss([
        async (root) => {

            root.walkDecls('--scope-hash', decl =>
            {
                decl.value = newHash;
            }
            )
        }
    ]).process (snapCss, {from:undefined});

    await writeFile (targetCssFile, result.css);

    await myGit.add (targetCssFile);
    await myGit.commit ('Snapshot hash update');
    await myGit.checkout (initBranch.my);
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




    export async function commitAllHashes ()
{
  const cssFiles = await globby([`${state.config.inputDir}/**/*.css`, `${state.config.teamGit}/**/*.css`]);

  const cssFilesStripped = [];
  for(const cssFile of cssFiles)
  {
    const css = await fs.promises.readFile (cssFile, 'utf-8');

    if (!css.includes ('--scope-hash'))
      continue;

    const savedState = {
      cssFile,
      css
    }
    cssFilesStripped.push (savedState);

    const result = await postcss([
        async (root) => {

            root.walkDecls ('--scope-hash', decl =>
            {
              decl.value = ''
            }
            );

        }]).process (css, {from:undefined});

      await writeFile (cssFile, result.css);
  }

  await myGit.add ('.');
  await myGit.commit ('Hashes stripped');
  await teamGit.add ('.');
  await teamGit.commit ('Hashes stripped');
  
  for(const {cssFile, css} of cssFilesStripped)
    await writeFile (cssFile, css);
  
  await myGit.add ('.');
  await teamGit.add ('.');
  await myGit.commit ('Hash update');
  await teamGit.commit ('Hash update');
}


async function updateDeps ()
{
  const hashAttrib = `data-scope-hash="${hash}"`;

  const localFiles = await globby ([`${config.inputDir}/**/*.html`, `${config.inputDir}/**/*.js`,`${config.inputDir}/**/*.ts`, `${config.inputDir}/**/*.jsx`,  `${config.inputDir}/**/*.tsx`])
    for (const localFile of localFiles)
    {
      const content = await fs.readFile (localFile, 'utf-8');
      
      const count = content.split (hashAttrib).length -1;
        }
}