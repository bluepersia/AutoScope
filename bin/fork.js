#!/usr/bin/env node
import path from 'path';
import {syncTeamRepo} from '../main/teamRepo.js';
import fs from 'fs'; 
import loadConfig from './loadConfig.js';

const args = process.argv.slice(2); // Skip first two elements (node and script path)

let hash;
let dontFlatten = true;
args.forEach((arg, index) => {
  if (arg === '--hash' && args[index + 1]) {
    hash = args[index + 1];
  }

  if (arg === '--dontFlatten' && args[index + 1])
    dontFlatten = args[index + 1]
});

if (!hash) {
  console.error('Please provide a hash using --hash <value>');
  process.exit(1);
}
const config = await loadConfig ();

  async function sync() {
    let config;
    try {
      config = require(path.resolve(process.cwd(), 'scoped-css.config.js'));
    } catch (e) {
      console.error('Error: could not load scoped-css.config.cjs');
      process.exit(1);
    }
  
    config = await init(config,null, false, true);
    config.dontFlatten = dontFlatten;


    await syncTeamRepo(config, [], hash);
   // checkDevMode (config, readTeamIDs);
  }


