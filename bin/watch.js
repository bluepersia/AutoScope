#!/usr/bin/env node
import path from 'path';
import fs from 'fs';
import chokidar from 'chokidar';
import { exec } from 'child_process';
import { build } from '../index.js';
import loadConfig from './loadConfig.js';
import { state } from '../shared.js';



import {
  onRemove,
  onChange,
  onAdded,
  onRemovePublic,
  onChangePublic,
} from '../main/devFileReactions.js';

let timeout;
let removedTimeout;
const changedFiles = new Set();
const removedFiles = new Set();
const addedFiles = new Set();
let publicTimeout;
let publicRemovedTimeout;
const publicChangedFiles = new Set();
const publicRemovedFiles = new Set();

const queueTasks = [];
let processing = false;

async function enqueue(task) {
  queueTasks.push(task);
  if (processing) return;
  processing = true;
  while (queueTasks.length > 0) {
    const nextTask = queueTasks.shift();
    try {
      await nextTask();
    } catch (e) {
      console.error('Task in queue failed:', e);
    }
  }
  processing = false;
}
/*
const waitForIdle = () =>
  new Promise((resolve) => {
    const check = () => {
      if (!getState().isBusy) return resolve();
      setTimeout(check, 50); // check every 50ms
    };
    check();
  });*/

// 1. Load your config
let config = await loadConfig();

let runtimeMap;
const mapPath = path.join(
  process.cwd(),
  config.outputDir || 'dist',
  'data',
  'scope-css-map.json'
);

try {
  if (fs.existsSync(mapPath)) {
    const content = fs.readFileSync(mapPath, 'utf8');
    runtimeMap = JSON.parse(content);
  }
} catch (err) {
  console.error('Failed to read scope-css-map.json:', err.message);
}
// 2. Derive the set of root directories to watch.
//    For each glob like "src/**/*.html" or "components/**/*.css",
//    take the part before the first "/*" as the watch root.
const args = process.argv.slice(2);
const noJS = args.includes('--noJS');

if (noJS) config.copyJs = false;

await build(config, runtimeMap, true);

if (args.includes('--watch')) 
{

config = state.config;
const watchArr = [];
if (config.inputHtml) watchArr.push(...config.inputHtml);

if (config.inputCss) watchArr.push(...config.inputCss);

if (config.inputJs) watchArr.push(...config.inputJs);

if (config.inputImages) watchArr.push(...config.inputImages);

const watchRoots = Array.from(
  new Set(
    watchArr
      .map((pattern) => pattern.split(/[*{]/)[0]) // "src/"
      .map((dir) => dir.replace(/\/$/, '')) // trim trailing slash
      .map((dir) => path.resolve(process.cwd(), dir)) // absolute path
      .concat(config.inputDir)
  )
);

/*
if (config.teamRepo)
{

  let changedScanIDFiles = new Set ();
  let scanIDsTimeout;

  const watchIDRoots = Array.from (
    new Set(
      config.teamRepo
      .map((pattern) => pattern.split(/[*{]/)[0]) // "src/"
      .map((dir) => dir.replace(/\/$/, '')) // trim trailing slash
      .map((dir) => path.resolve(process.cwd(), dir)) // absolute path
    )
  )

  const scanIDsWatcher = chokidar.watch (watchIDRoots, {
    ignoreInitial: true,
    usePolling: true,
    interval: 200,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 100
    }
  })

  scanIDsWatcher
  .on('all', (event, filePath) => {
    if (
      ['add', 'change'].includes(event) &&
      shouldTrigger(filePath)
    ) {
      changedScanIDFiles.add(filePath);
      clearTimeout(scanIDsTimeout);
      scanIDsTimeout = setTimeout(() => {
      //readTeamIDs (Array.from (changedScanIDFiles).filter (file => file.endsWith ('.css')));
      build ();
      changedScanIDFiles.clear();
  }, 100);
    }
    else if (event === 'unlink')
    {
      removedTeamFiles.add(filePath);
      clearTimeout(removedTeamIDTimeout);
      removedTeamIDTimeout = setTimeout(() => {
      //onTeamIDsRemoved (Array.from (removedTeamFiles).filter (file => file.endsWith ('.css')));
      build ();
      removedTeamFiles.clear();
      });
    }
    build ();
  })
  .on('error', (err) => console.error('scanIDsWatcher error:', err));
}

console.log('🔍 Watching directories:');
watchRoots.forEach((d) => console.log('   ', d));
*/

// 3. Build a single watcher on those roots, with polling & write‑finish:
const watcher = chokidar.watch(watchRoots, {
  ignoreInitial: true,
  usePolling: true,
  interval: 200,
  awaitWriteFinish: {
    stabilityThreshold: 200,
    pollInterval: 100,
  },
});

if (config.copyFiles) {
  const publicWatcher = chokidar.watch(config.copyFiles, {
    ignoreInitial: true,
    usePolling: true,
    interval: 200,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 100,
    },
  });

  publicWatcher.on('all', async (event, filePath) => {
    if (['add', 'change'].includes(event)) {
      publicChangedFiles.add(filePath);
      clearTimeout(publicTimeout);
      publicTimeout = setTimeout(async () => {
        const files = Array.from(publicChangedFiles);
        publicChangedFiles.clear();
        enqueue(async () => {
          await onChangePublic(files);
        });
      }, 100);
    } else if (event === 'unlink') {
      publicRemovedFiles.add(filePath);
      clearTimeout(publicRemovedTimeout);
      publicRemovedTimeout = setTimeout(async () => {
        const files = Array.from(publicRemovedFiles);
        publicRemovedFiles.clear();
        enqueue(async () => {
          await onRemovePublic(files);
        });
      }, 100);
    }
  });
}
watcher.on('ready', () => {
  console.log('🚀 Dev mode started');
});

// 4. On any file event, filter by your original glob patterns:
function shouldTrigger(filePath) {
  const rel = path.relative(process.cwd(), filePath);

  // Check against glob patterns
  //const matchesGlob = watchArr.some((pattern) => minimatch(rel, pattern));

  // Check if file is inside inputDir
  const isInInputDir =
    config.inputDir && rel.startsWith(config.inputDir + path.sep);

  return isInInputDir;
}

let buildTimeout;
function runBuild() {
  return;
  // debounce rapid sequences of events
  if (buildTimeout) clearTimeout(buildTimeout);
  buildTimeout = setTimeout(() => {
    console.log('🔨 Changes detected — running build...');
    exec('npx scope-css-build', (error, stdout, stderr) => {
      if (error) {
        console.error('❌ Build failed:', error.message);
        return;
      }
      if (stdout) console.log(stdout.trim());
      if (stderr) console.error(stderr.trim());
    });
  }, 300);
}

async function waitForFilesExist(
  filePaths,
  timeoutMs = 2000,
  intervalMs = 100
) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const existChecks = filePaths.map((p) => fs.existsSync(p));
    if (existChecks.every((p) => p === true)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return false;
}

// 5. Wire up all events through our filter
watcher
  .on('all', async (event, filePath) => {
    if (['add', 'change'].includes(event) && shouldTrigger(filePath)) {
      //if (event === 'add' && filePath.endsWith('.css')) onAddedCss([filePath]);

      changedFiles.add(filePath);

      if(event === 'add')
        addedFiles.add (filePath);

      clearTimeout(timeout);
      timeout = setTimeout(async () => {
        const files = Array.from(changedFiles);
        changedFiles.clear();

        const filesAdded = Array.from (addedFiles);
        addedFiles.clear ();
        //await waitForFilesExist(files);
        enqueue(async () => {
          await onAdded (filesAdded);
          await onChange(files);
        });
      }, 100);
    } else if (event === 'unlink') {
      removedFiles.add(filePath);
      clearTimeout(removedTimeout);
      removedTimeout = setTimeout(() => {
        const files = Array.from(removedFiles);
        removedFiles.clear();
        enqueue(async () => {
          await onRemove(files);
        });
      }, 100);
    }
  })
  .on('error', (err) => console.error('Watcher error:', err));
}