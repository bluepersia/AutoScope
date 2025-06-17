#!/usr/bin/env node
import path from 'path';
import { globby } from 'globby';
import fs from 'fs';
import { getHasClassRegex, getHasClassNameRegex, state } from '../shared.js';
import loadConfig from './loadConfig.js';
import {initTeamSrc} from "../index.js";

const args = process.argv.slice(2); // Skip first two elements (node and script path)

let nameArg;

args.forEach((arg, index) => {
  if (arg === '--name' && args[index + 1]) {
    nameArg = args[index + 1];
  }
});

if (!nameArg && process.argv[1].endsWith('where')) {
  console.error('Please provide a name using --name <value>');
  process.exit(1);
}

const config = await loadConfig();
state.config = config;
initTeamSrc();

async function readFilesUsing(name = nameArg) {
  const allFiles = await globby(config.teamGit ? config.teamSrc.length <= 1 ? `${config.teamGit}/${config.teamSrc[0]}` : config.teamSrc.map(src => `${config.teamGit}/${src}`) : `${config.outputDir}/**/*`);

  const htmlFiles = allFiles.filter(
    (f) => f.endsWith('.html') || f.endsWith('.js') || f.endsWith ('.ts')
  );
  const reactFiles = allFiles.filter(
    (f) => f.endsWith('.jsx') || f.endsWith('.tsx')
  );

  const classRegex = getHasClassRegex(name);
  const classNameRegex = getHasClassNameRegex(name);

  const filesUsing = [];
  for (const htmlFile of htmlFiles) {
    const html = await fs.promises.readFile(htmlFile, 'utf-8');
    
    if (classRegex.test(html)) filesUsing.push(htmlFile);
  }

  for (const reactFile of reactFiles) {
    const jsx = await fs.promises.readFile(reactFile, 'utf-8');

    if (classNameRegex.text(html)) filesUsing.push(jsx);
  }

  if (filesUsing.length <= 0) {
    console.log('No files found.');
    return;
  }
  console.log(`Files using ${name}:`);

  for (const file of filesUsing) console.log(file);
}
if (process.argv[1].endsWith('where')) readFilesUsing();

export { readFilesUsing };
