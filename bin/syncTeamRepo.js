#!/usr/bin/env node
import path from 'path';
import { init, checkDevMode} from '../index.js';
import { syncTeamRepo, readTeamIDs } from '../main/teamRepo.js';
import loadConfig from './loadConfig.js';

async function sync() {
  let config = await loadConfig ();
  config = await init(config,null, false, true);
  await syncTeamRepo(config);
  //checkDevMode (config, readTeamIDs);
}

sync();
