#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { globby } from 'globby';
import fsExtra from 'fs-extra';
import http from 'http';
import postcss from 'postcss';
import { readMetaTags } from './main/readMetaTags.js';
import {
  state,
  prefixGlobsWithDir,
  setConfig,
  copyFiles,
  findHtmlDeps,
  getRelativePathFrom,
  findDomsInCache,
} from './shared.js';
import { writeCssAndHtml } from './main/conversion.js';
import { readTeamIDs } from './main/teamRepo.js';
import os from 'os';
import crypto from 'crypto';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';

let prettier;
let ESLint;
let stylelint;

const require = createRequire(
  pathToFileURL(path.join(process.cwd(), 'index.js')).href
);
try {
  prettier = require('prettier');
} catch {}
try {
  ESLint = require('eslint')?.ESLint;
} catch {}
try {
  stylelint = require('stylelint');
} catch {}

async function init(newConfig, runtimeMp, devMd = false) {
  if (newConfig === state.config) return state.config;

  state.config = { ...state.config, ...newConfig };

  state.devMode = devMd;

  state.config.initOutputDir = state.config.outputDir;
  if (devMd) {
    state.config.outputDir = 'dev-temp';
  }

  if (state.devMode) {
    state.config.devMode = true;
    state.config.mergeCss = false;
    process.on('SIGINT', cleanUp);
    if (state.config.teamRepo) startDevServer();
  }

  if (state.config.copyFiles === true)
    state.config.copyFiles = state.config.teamRepo || state.config.inputDir;

  //if (state.config.globalCss)
  //state.globalCss = prefixGlobsWithDir (state.config.globalCss, state.inputDir);

  await initInputCss(state.config);

  if (state.config.teamRepo) await initTeamRepoHashMap();

  state.mergeCssMap = {};

  initCombinatorFlattening(state.config);
  initFormatters();

  if (runtimeMp) state.runtimeMap = runtimeMp;

  /*
  if (fs.existsSync(idCachePath)) {
    const json = await fs.promises.readFile(idCachePath, 'utf-8');
    scopeIDsCache = JSON.parse(json);
  } else await fs.promises.writeFile(idCachePath, JSON.stringify({}), 'utf-8');
*/

  /*
  if (globalCss)
  {
    if (Array.isArray (globalCss.length))
      inputCss.push (...globalCss.map (g => `!${g}`));
    else 
      inputCss.push (`!${globalCss}`);
  }*/

  await initInputHtml(state.config);
  await initInputReact(state.config);

  return state.config;
}

function getScssFolder() {
  return `!${state.config.inputDir}/scss/**`;
}
/*
async function startUp ()
{
  if (state.config.copyFiles)
    copyFiles(state.inputDir, state.outputDir);

  await readMetaTags (state.htmlFiles)
  
  if (state.config.teamRepo)
     await readTeamIDs ();


 // if (state.globalCss)
    //await readGlobalCss ();

}*/

function initFormatters() {
  state.config.prettierConfig = state.config.prettierConfig || {};
  state.config.ESLintConfig = state.config.ESLintConfig || {};
  state.config.stylelintConfig = state.config.stylelintConfig || {};

  if (stylelint)
    state.cssFormatter = async (input) =>
      await stylelint.lint({
        code: input,
        config: state.config.stylelintConfig,
        fix: true,
      });
  else if (prettier)
    state.cssFormatter = async (input) =>
      await prettier.format(input, {
        parser: 'css',
        ...state.config.prettierConfig,
      });
  else state.cssFormatter = async (input) => input;

  if (ESLint) {
    const eslint = new ESLint({
      baseConfig: state.config.ESLintConfig,
      fix: true,
    });
    state.jsFormatter = async (input) => await eslint.lintText(input);
  } else if (prettier) {
    state.jsFormatter = async (input) =>
      await prettier.format(input, {
        parser: 'babel',
        ...state.config.prettierConfig,
      });
    state.tsFormatter = async (input) =>
      await prettier.format(input, {
        parser: 'babel-ts',
        ...state.config.prettierConfig,
      });
  } else {
    state.jsFormatter = async (input) => input;
    state.tsFormatter = state.jsFormatter;
  }

  state.htmlFormatter = prettier
    ? async (input) => {
        console.log('prettier');
        return await prettier.format(input, {
          parser: 'html',
          ...state.config.prettierConfig,
        });
      }
    : async (input) => input;
}

async function initTeamRepoHashMap() {
  const cssFiles = await globby(state.config.teamRepo);

  state.teamRepoHashMap = {};

  for (const cssFile of cssFiles) {
    const css = await fs.promises.readFile(cssFile, 'utf-8');

    if (css.includes('--scope-hash:')) {
      {
        const { root } = await postcss().process(css, { from: undefined });

        root.walkDecls((decl) => {
          if (decl.prop === '--scope-hash') {
            const filePath = path.relative(state.config.teamRepo, cssFile);

            state.teamRepoHashMap[
              decl.parent.selector
                .split(',')[0]
                .trim()
                .replaceAll('.', '')
                .replace(/-\w+$/, '') +
                '/' +
                decl.value.split(' ')[0].trim()
            ] = { cssRoot: root, filePath };
          }
        });
      }
    }
  }
}

async function checkDevMode(cb = () => {}) {
  try {
    const req = http.request(
      {
        hostname: 'localhost',
        port: 3012,
        path: '/check',
        method: 'GET',
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', async () => {
          cb(true);
        });
      }
    );

    req.on('error', (err) => {
      cb(false);
    });

    req.end();
  } finally {
  }
}
async function initInputReact(config) {
  const inputDirReact = [
    `${config.inputDir}/**/*.jsx`,
    `${config.inputDir}/**/*.tsx`,
  ];
  config.inputReact = config.inputReact
    ? prefixGlobsWithDir(config.inputReact, state.config.inputDir)
    : inputDirReact;

  config.inputReact.push(getScssFolder());

  state.reactFiles = await globby(config.inputReact);
}
async function initInputHtml(config) {
  const inputDirHtml = `${config.inputDir}/**/*.html`;
  config.inputHtml = config.inputHtml
    ? prefixGlobsWithDir(config.inputHtml, state.config.inputDir)
    : [inputDirHtml];

  config.inputHtml.push(getScssFolder());

  state.htmlFiles = await globby(config.inputHtml);
}

async function initInputCss(config) {
  const inputDirCss = `${config.inputDir}/**/*.css`;
  config.inputCss = state.config.inputCss
    ? prefixGlobsWithDir(config.inputCss, state.config.inputDir)
    : [inputDirCss];

  config.inputCss.push(getScssFolder());

  state.cssFiles = await globby(state.config.inputCss);

  state.cssScopes = [
    ...state.cssFiles.map((file) => path.basename(file, '.css')),
  ];
}

function initCombinatorFlattening(config) {
  let flattenCombis = config.flattenCombis;
  if (flattenCombis === true) flattenCombis = Object.keys(state.allCombis);
  else if (flattenCombis === false) flattenCombis = [];
  else flattenCombis = [];

  config.flattenCombis = flattenCombis;
}

function startDevServer() {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/reload' && req.method === 'POST') {
      state.isBusy = true;
      await readTeamIDs();
      await initTeamRepoHashMap();
      state.isBusy = false;
      res.writeHead(200);
      res.end('Reloaded');
    } else if (req.url === '/check' && req.method === 'GET') {
      res.writeHead(200);
      res.end('Online');
    } else if (req.url === '/build') {
      return;
      res.writeHead(200);
      await readTeamIDs();
      await fsExtra.emptyDir('dev-temp');
      await fsExtra.copy(state.config.teamRepo, 'dev-temp');
      await build(state.config);
      res.end('Built!');
    } else if (req.url === '/read-team') {
      await readTeamIDs();
      await initTeamRepoHashMap();

      //await fs.promises.rm('dev-temp', { recursive: true, force: true });
      //await fsExtra.copy(state.config.teamRepo, 'dev-temp');
      console.log('Read team repo');
      res.end('Read team repo');
    } else if (req.url === '/resolve-build') {
      res.end('Resolved.');
      let body = '';

      // Collect data
      req.on('data', (chunk) => {
        body += chunk.toString(); // convert Buffer to string
      });

      // Done receiving data
      req.on('end', async () => {
        try {
          // const data = JSON.parse(body);
          //  await readMetaTags(data.htmlDeps);
          //  await writeCssAndHtml([data.filePath], data.htmlDeps);
          // res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('Resolved');
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  server.listen(3012, () => console.log('Dev API running on port 3001'));
}

async function onAddedCss(filePaths) {
  for (const filePath of filePaths) {
    const scopeName = path.basename(filePath, '.css');
    if (!state.cssScopes.includes(scopeName)) state.cssScopes.push(scopeName);
  }
}

/*
async function onChangeTeam (filePaths)
{
  if (config.scanIDs)
    readTeamIDs (filePaths.filter (file => file.endsWith ('.css')));
  
}*/

/*

async function readMyCss(globalCssFiles) {

  

  state.cssFiles = state.cssFiles.filter (file => !globalCssFiles.includes (file));
  for (const file of state.cssFiles) {
    const fileName = path.basename(file, '.css');

    addIdToIdCache (fileName, {filePath: file, id: getFreeId (fileName)});

    const newHash = state.scopeHashFileMap[file] = generateCssModuleHash (file, fileName, 1);
    if(!state.scopeHashsMap[file])
      state.scopeHashsMap[file] = new Set();

    state.scopeHashsMap[file].add (newHash);

    const count = cssFiles.reduce(
      (prev, curr) =>
        path.basename(curr, '.css') === fileName ? prev + 1 : prev,
      -1
    );

    const cachedCount = scopeIDsMap.hasOwnProperty(fileName)
      ? scopeIDsMap[fileName]
      : -1;

    if (!scopeIDsMap.hasOwnProperty(fileName) || count > cachedCount)
      scopeIDsMap[fileName] = count;
  }
}
*/

/*
async function onTeamIDsRemoved (filePaths)
{
  for (const [key, arr] of Object.entries (teamIDsUsed))
  {
    const newArr = arr.filter (file => !filePaths.includes(file));
    if (arr.length <= 0)
      delete teamIDsUsed[key];
    else 
      teamIDsUsed[key] = newArr;
  }
}*/
/*
async function readAndWriteCss (filePaths)
{
  const htmlConnected = new Set ();
  for(const filePath of filePaths)
  {
    if (metaCache[filePath])
      htmlConnected.add (...metaCache[filePath]);
  }
  await writeCssAndHtml (filePaths.filter (file => file.endsWith ('.css')), Array.from (htmlConnected));
}*/
function getMachineTagId(length = 4) {
  const interfaces = os.networkInterfaces();

  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
        const hash = crypto.createHash('sha1').update(net.mac).digest('hex');
        return hash.slice(0, length); // e.g., "3f2a"
      }
    }
  }

  return 'anon'; // Fallback if no MAC found
}
async function build(cfg = config, runtimeMap = null, devMode = false) {
  await setConfig(await init(cfg, runtimeMap, devMode));

  if (state.config.teamRepo !== state.config.outputDir) {
    if (fs.existsSync(state.config.outputDir))
      await fs.promises.rm(state.config.outputDir, {
        recursive: true,
        force: true,
      });

    await fs.promises.mkdir(state.config.outputDir);
  }

  if (
    state.config.copyFiles &&
    (!state.config.teamRepo || state.config.devMode)
  ) {
    if (Array.isArray(state.config.copyFiles)) {
      state.config.copyFiles = state.config.copyFiles.filter(
        (p) => p !== state.config.outputDir
      );
      for (const dir of state.config.copyFiles)
        copyFiles(dir, state.config.outputDir);
    } else {
      if (state.config.copyFiles === state.config.outputDir) {
        state.config.copyFiles = '';
        return;
      }
      copyFiles(state.config.copyFiles, state.config.outputDir);
    }
  }

  if (state.config.teamRepo) await readTeamIDs();

  //copyGlobalCss();

  await readMetaTags(state.htmlFiles);
  await writeCssAndHtml(
    state.cssFiles,
    findDomsInCache(state.htmlFiles),
    findDomsInCache(state.reactFiles)
  );

  console.log('scoped-css-module: build complete');
}

function removeIdFromCache(filePath) {
  const scopeName = path.basename(filePath);

  if (!state.scopeIDsCache[scopeName]) return;

  state.scopeIDsCache[scopeName] = state.scopeIDsCache[scopeName].map((obj) =>
    obj.filePath === filePath ? { id: obj.id } : obj
  );
}

/*async function saveIdCache() {
  const json = JSON.stringify(scopeIDsCache);
  await fs.promises.writeFile(idCachePath, json, 'utf-8');
}*/

/*
  metaTags.forEach((tag) => {
    if (!mergeCss)
      insertLinkIntoHead(
        dom,
        tag.content.replace(`${inputDir}/`, `${outputDir}/`)
      );
    let scopeId = '';
    if (tag.name.startsWith('scope-css-'))
      scopeId = tag.name.split('scope-css-')[1];

    tag.scopeId = scopeId;
    tag.scopeName = path.basename(tag.content, '.css');

  tag.relativePath = getRelativePathFrom (tag.content, dom.filePath);
  
});*/

async function copyGlobalCss(
  from = state.config.inputDir,
  to = state.config.outputDir
) {
  let globalCss = state.config.globalCss;
  if (!globalCss) return;

  if (Array.isArray(globalCss.length)) globalCss = [globalCss];

  globalCss = prefixGlobsWithDir(globalCss, from);

  const globalCssFiles = await globby(globalCss);

  for (const globalCssFile of globalCssFiles) {
    const relativePath = path.relative(from, globalCssFile);

    const outPath = path.join(to, relativePath);

    await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
    await fs.promises.copyFile(globalCssFile, outPath);
  }
}

let hasShutDown;
async function cleanUp() {
  if (hasShutDown) return;
  hasShutDown = true;

  await fs.promises.rm('dev-temp', { recursive: true, force: true });
  process.exit();
}

/*REACT*/

function extractScopeCss(ast) {
  let result = null;

  traverse(ast, {
    VariableDeclarator(path) {
      const { node } = path;

      // Check name and that it's top-level
      if (
        node.id.name === 'scopeCss' &&
        path.parentPath.parent.type === 'Program'
      ) {
        if (node.init?.type === 'ArrayExpression') {
          result = node.init.elements
            .filter((el) => el.type === 'StringLiteral')
            .map((el) => el.value);
        }
      }
    },
  });

  return result;
}
export {
  init,
  build,
  getRelativePathFrom,
  onAddedCss,
  initInputCss,
  initCombinatorFlattening,
  checkDevMode,
  initInputHtml,
  findDomsInCache,
  copyGlobalCss,
  initTeamRepoHashMap,
  initInputReact,
  initFormatters,
};
