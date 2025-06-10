#!/usr/bin/env node
import path from 'path';
import globby from 'globby';
import fs from 'fs';
import {getHasClassRegex, getHasClassNameRegex} from '../shared.js';
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

async function readFilesUsing ()
{
const allFiles = await globby (`${config.teamRepo || config.outputDir}/**/*`);

const htmlFiles = allFiles.filter (f => f.endsWith ('.html') || f.endsWith ('.js'));
const reactFiles = allFiles.filter (f => f.endsWith ('.jsx') || f.endsWith ('.tsx'));

const classRegex = getHasClassRegex (name);
const classNameRegex = getHasClassNameRegex (name);

const filesUsing = [];
for (const htmlFile of htmlFiles)
{
    const html = await fs.promises.readFile (htmlFile, 'utf-8');
   
    if (classRegex.test (html))
        filesUsing.push (htmlFile);
}

for (const reactFile of reactFiles)
{
  const jsx = await fs.promises.readFile (reactFile, 'utf-8');

  if (classNameRegex.text (html))
    filesUsing.push (jsx);
}

if (filesUsing.length <= 0)
{
    console.log ('No files found.');
    return;
}
console.log (`Files using ${name}:`);

for(const file of filesUsing)
    console.log (file);


}


if (process.argv[1].endsWith ('where.cjs'))
    readFilesUsing ();


export {readFilesUsing};