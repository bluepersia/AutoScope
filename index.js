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
  findDomsInCache,
} from './shared.js';
import { writeCssAndHtml } from './main/conversion.js';
import { readTeamIDs } from './main/teamRepo.js';
import os from 'os';
import crypto from 'crypto';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';
import simpleGit from 'simple-git';

let prettier;
let ESLint;
let stylelint;
let biome;
let beautify;

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
try {
  biome = require('@biomejs/biome');
} catch {}

try {
  beautify = require('js-beautify');
} catch (err) {}

async function init(newConfig, runtimeMp, devMd = false) {
  if (newConfig === state.config) return state.config;

  state.config = { ...state.config, ...newConfig };

  state.devMode = devMd;

  initTeamSrc();

  state.config.initOutputDir = state.config.outputDir;
  if (devMd) {
    state.config.outputDir =
      state.config.teamSrc?.length <= 1
        ? `dev-temp/${state.config.teamSrc[0]}`
        : 'dev-temp';
  }

  if (state.devMode) {
    state.config.devMode = true;
    state.config.mergeCss = false;
    process.on('SIGINT', cleanUp);
    if (state.config.teamSrc) startDevServer();
  }

  if (!state.config.copyFiles && state.config.teamGit)
    state.config.copyFiles = state.config.teamGit;
  else if (state.config.copyFiles === true)
    state.config.copyFiles = state.config.teamGit || state.config.inputDir;

  //if (state.config.globalCss)
  //state.globalCss = prefixGlobsWithDir (state.config.globalCss, state.inputDir);

  if (state.config.teamSrc) await initTeamRepoHashMap();

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

function initTeamSrc() {
  if (state.config.teamGit && !state.config.teamSrc)
    state.config.teamSrc = ['src'];
  else if (state.config.teamSrc && !Array.isArray(state.config.teamSrc))
    state.config.teamSrc = [state.config.teamSrc];

  if (state.config.teamGit)
  {
    state.teamGit = simpleGit(`${process.cwd()}/${state.config.teamGit}`);

    if (state.config.teamSrc.length <= 1)
    state.config.outputDir = `${state.config.teamGit}/${state.config.teamSrc[0]}`;
  else 
    state.config.outputDir = state.config.teamGit;
  }
}
function initFormatters() {

  state.config.formatters = state.config.formatters || {};

  let {
    css = [],
    html = [],
    js = [],
    jsx = [],
    ts = [],
    tsx = [],
    all =[]
  } = state.config.formatters;


  const defaultStylelintConfig = {
    extends: [
      'stylelint-config-standard'      // Sensible rules
    ],
    rules: {
      'indentation': 2,
      'string-quotes': 'double',
      'color-hex-case': 'lower',
      'block-no-empty': true,
      'no-empty-source': null, // Allow empty files
      'selector-class-pattern': null,   // Disable BEM naming enforcement (optional)
      'declaration-empty-line-before': 'never', // Avoid rule conflicts with Prettier
      'declaration-block-semicolon-newline-after': 'never'
    },
    ignoreFiles: ['**/node_modules/**', '**/dist/**']
  }

  const defaultEslintConfig = [
    {
      languageOptions: {
        ecmaVersion: 2024,
        sourceType: 'module',
        globals: {
          // Browser globals
          window: 'readonly',
          document: 'readonly',
          console: 'readonly',
          // Node globals  
          process: 'readonly',
          __dirname: 'readonly',
          __filename: 'readonly',
          Buffer: 'readonly',
          global: 'readonly'
        }
      },
      rules: {
        // Error Prevention
        'no-undef': 'error',
        'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
        'no-console': 'off', // Allow console in dev tools
        'no-debugger': 'warn',
        
        // Best Practices  
        'eqeqeq': ['error', 'always'],
        'curly': ['error', 'multi-line'],
        'no-eval': 'error',
        'no-implied-eval': 'error',
        'no-new-func': 'error',
        
        // Style (Light - let Prettier handle most)
        'semi': ['error', 'always'],
        'quotes': ['error', 'single', { allowTemplateLiterals: true }],
        'no-trailing-spaces': 'error',
        'eol-last': 'error',
        
        // Modern JS
        'prefer-const': 'error',
        'no-var': 'error',
        'prefer-arrow-callback': 'warn',
        'prefer-template': 'warn'
      }
    }
  ]

  if (css.includes ('prettier'))
    defaultStylelintConfig.extends.push ('stylelint-config-prettier')




  state.config.formatters.prettierConfig =
    state.config.formatters.prettierConfig || {};
  state.config.formatters.eslintConfig =
    state.config.formatters.eslintConfig || defaultEslintConfig;
  state.config.formatters.stylelintConfig =
    state.config.formatters.stylelintConfig || defaultStylelintConfig;
  state.config.formatters.biomeConfig =
    state.config.formatters.biomeConfig || {};
  state.config.formatters.beautifyConfig =
    state.config.formatters.beautifyConfig || {};

  let eslint;
  if (ESLint) {
    eslint = new ESLint({
      baseConfig: state.config.formatters.eslintConfig,
      overrideConfigFile: true,
      fix: true,
    });
  }



  if (css && !Array.isArray(css)) css = [css];

  state.cssFormatters = [];
  state.cssFormatter = async (input) => {
    for (const formatter of state.cssFormatters) input = await formatter(input);

    return input;
  };

  if (prettier && (all.includes ('prettier') || css.includes('prettier')))
    state.cssFormatters.push(
      async (input) =>
        await prettier.format(input, {
          parser: 'css',
          ...state.config.formatters.prettierConfig,
        })
    );
  if (beautify && (all.includes ('prettier') || css.includes('beautify'))) {
    let skip;
    if (state.cssFormatters.length > 0) {
      console.warn('Prettier + Beautify is not recommended.');
      if (state.config.formatters.autoResolveConflicts !== false) {
        skip = true;
        console.warn('Skipping beautify for css.');
      }
    }
    if (!skip)
      state.cssFormatters.push(async (input) =>
        beautify.css(input, state.config.formatters.beautifyConfig)
      );
  }
  if (stylelint && (all.includes('stylelint') || css.includes('stylelint')))
    state.cssFormatters.push(
      async (input) =>
        (await stylelint.lint({
          code: input,
          config: state.config.formatters.stylelintConfig,
          fix: true,
        })).code
    );

  if (js && !Array.isArray(js)) js = [js];

  state.jsFormatters = [];
  state.jsFormatter = async (input) => {
    for (const formatter of state.jsFormatters) input = await formatter(input);

    return input;
  };

  if (ts && !Array.isArray(ts)) ts = [ts];

  state.tsFormatters = [];
  state.tsFormatters = async (input) => {
    for (const formatter of state.tsFormatters) input = await formatter(input);

    return input;
  };

  if (jsx && !Array.isArray(jsx)) jsx = [jsx];

  state.jsxFormatters = [];
  state.jsxFormatter = async (input) => {
    for (const formatter of state.jsxFormatters) input = await formatter(input);

    return input;
  };

  if (tsx && !Array.isArray(tsx)) tsx = [tsx];

  state.tsxFormatters = [];
  state.tsxFormatter = async (input) => {
    for (const formatter of state.tsxFormatters) input = await formatter(input);

    return input;
  };

  if (prettier) {
    if (js.includes('prettier') || all.includes('prettier'))
      state.jsFormatters.push(
        async (input) =>
          await prettier.format(input, {
            parser: 'babel',
            ...state.config.formatters.prettierConfig,
          })
      );
    if (jsx.includes('prettier') || all.includes('prettier'))
      state.jsxFormatters.push(
        async (input) =>
          await prettier.format(input, {
            parser: 'babel',
            ...state.config.formatters.prettierConfig,
          })
      );

    if (ts.includes('prettier') || all.includes ('prettier'))
      state.tsFormatters.push(
        async (input) =>
          await prettier.format(input, {
            parser: 'babel-ts',
            ...state.config.formatters.prettierConfig,
          })
      );
    if (tsx.includes('prettier') || all.includes ('prettier'))
      state.tsxFormatters.push(
        async (input) =>
          await prettier.format(input, {
            parser: 'babel-ts',
            ...state.config.formatters.prettierConfig,
          })
      );
  }

  if (ESLint) {
    if (js.includes('eslint') || all.includes ('eslint'))
      state.jsFormatters.push(async (input) => {
        const results = await eslint.lintText(input, { filePath: 'dummy.js' });
        const fixedCode = results[0].output ?? input;
        return fixedCode;
      });

    const hasTypeScriptPlugin =
      state.config.formatters.eslintConfig.plugins?.hasOwnProperty(
        '@typescript-eslint'
      );

    if ((ts.includes('eslint') || all.includes('eslint')) && !hasTypeScriptPlugin)
      console.warn(
        'Typescript plugin not installed. Skipping eslint typescript.'
      );
    else if (ts.includes('eslint') && hasTypeScriptPlugin) {
      state.tsFormatters.push(async (input) => {
        const results = await ESLint.lintText(input, { filePath: 'dummy.ts' });
        const fixedCode = results[0].output ?? input;
        return fixedCode;
      });
    }
    const hasReactPlugin =
      state.config.formatters.eslintConfig.plugins?.hasOwnProperty(
        'eslint-plugin-react'
      );

    if ((jsx.includes('eslint') || all.includes('eslint')) && !hasReactPlugin)
      console.warn(
        'React plugin for eslint not installed. Skipping eslint for React.'
      );
    else if (hasReactPlugin && jsx.includes('eslint')) {
      state.jsxFormatters.push(async (input) => {
        const results = await eslint.lintText(input, { filePath: 'dummy.jsx' });
        const fixedCode = results[0].output ?? input;
        return fixedCode;
      });
    }
    if (tsx.includes('eslint') || all.includes ('eslint')) {
      if (!hasReactPlugin)
        console.warn(
          'React plugin for eslint not installed. Skipping eslint for TSX files'
        );
      else if (!hasTypeScriptPlugin)
        console.warn(
          'Typescript plugin for eslint not installed. Skipping eslint for TSX files'
        );
    } else if (
      (tsx.includes('eslint') || all.includes ('eslint'))  &&
      hasReactPlugin &&
      hasTypeScriptPlugin
    ) {
      state.tsxFormatters.push(async (input) => {
        const results = await ESLint.lintText(input, { filePath: 'dummy.tsx' });
        const fixedCode = results[0].output ?? input;
        return fixedCode;
      });
    }
  }
  if (biome) {
    if (js.includes('biome') || all.includes ('biome')) {
      let skip;
      if (state.jsFormatters.length > 0) {
        console.warn('ESLint/Prettier + Biome not recommended for JS.');
        if (state.config.autoResolveConflicts !== false) {
          skip = true;
          console.warn('Skipping Biome for JS.');
        }
      }
      if (!skip)
        state.jsFormatters.push(
          async (input) =>
            await biome.format({
              filePath: 'dummy.js',
              content: input,
              config: state.config.formatters.biomeConfig,
            })
        );
    }
    if (jsx.includes('biome') || all.includes ('biome')) {
      let skip;
      if (state.jsxFormatters.length > 0) {
        console.warn('ESLint/Prettier + Biome not recommended for JSX.');
        if (state.config.autoResolveConflicts !== false) {
          skip = true;
          console.warn('Skipping Biome for JSX.');
        }
      }
      if (!skip)
        state.jsxFormatters.push(
          async (input) =>
            await biome.format({
              filePath: 'dummy.jsx',
              content: input,
              config: state.config.formatters.biomeConfig,
            })
        );
    }

    if (ts.includes('biome') || all.includes ('biome')) {
      let skip;
      if (state.tsFormatters.length > 0) {
        console.warn('ESLint/Prettier + Biome not recommended for TS.');
        if (state.config.autoResolveConflicts !== false) {
          skip = true;
          console.warn('Skipping Biome for TS.');
        }
      }
      if (!skip)
        state.tsFormatters.push(
          async (input) =>
            await biome.format({
              filePath: 'dummy.ts',
              content: input,
              config: state.config.formatters.biomeConfig,
            })
        );
    }
    if (tsx.includes('biome') || all.includes ('biome')) {
      let skip;
      if (state.tsxFormatters.length > 0) {
        console.warn('ESLint/Prettier + Biome not recommended for TSX.');
        if (state.config.autoResolveConflicts !== false) {
          skip = true;
          console.warn('Skipping Biome for TSX.');
        }
      }
      if (!skip)
        state.tsxFormatters.push(
          async (input) =>
            await biome.format({
              filePath: 'dummy.tsx',
              content: input,
              config: state.config.formatters.biomeConfig,
            })
        );
    }
  }

  if (html && !Array.isArray(html)) html = [html];

  state.htmlFormatters = [];
  state.htmlFormatter = async (input) => {
    for (const formatter of state.htmlFormatters)
      input = await formatter(input);

    return input;
  };

  if (prettier && (html.includes('prettier') || all.includes ('prettier'))) {
    state.htmlFormatters.push(
      async (input) =>
        await prettier.format(input, {
          parser: 'html',
          ...state.config.prettierConfig,
        })
    );
  }

  if (beautify && (html.includes('beautify') || all.includes ('beautify'))) {
    let skip;
    if (state.htmlFormatters.length > 0) {
      console.warn('Prettier + Beautify not recommended.');
      if (state.config.autoResolveConflicts !== false) {
        skip = true;
        console.warn('Skipping Beautify for HTML.');
      }
    }
    if (!skip)
      state.htmlFormatters.push(async (input) =>
        beautify.html(input, state.config.beautifyConfig)
      );
  }

  console.log (state.jsFormatters);
}

async function initTeamRepoHashMap() {
  const cssFilesBySrc = await Promise.all(
    state.config.teamSrc.map(
      async (src) => await globby(`${state.config.teamGit}/${src}`)
    )
  );

  state.teamRepoHashMap = {};

  for (const [index, teamSrcFiles] of cssFilesBySrc.entries()) {
    for (const cssFile of teamSrcFiles) {
      const teamSrc = state.config.teamSrc[index];
      const css = await fs.promises.readFile(cssFile, 'utf-8');

      if (css.includes('--scope-hash:')) {
        {
          const { root } = await postcss().process(css, { from: undefined });

          root.walkDecls((decl) => {
            if (decl.prop === '--scope-hash') {
              const filePath = path.relative(
                cssFilesBySrc.length <= 1
                  ? `${state.config.teamGit}/${teamSrc}`
                  : state.config.teamGit,
                cssFile
              );

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
async function initInputJs(config) {
  const inputDirJs = [
    `${config.inputDir}/**/*.js`,
    `${config.inputDir}/**/*.ts`,
  ];
  config.inputJs = inputDirJs;
  /*config.inputJs
    ? prefixGlobsWithDir(config.inputJs, state.config.inputDir)
    : inputDirJs;*/

  state.jsFiles = await globby(config.inputJs);
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
  else if (!flattenCombis) flattenCombis = [];

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
async function build(
  cfg = config,
  runtimeMap = null,
  devMode = false,
  overwrite = true
) {
  await setConfig(await init(cfg, runtimeMap, devMode));

  const htmlFiles = await globby(`${state.config.inputDir}/**/*.html`);
  const jsFiles = await globby([
    `${state.config.inputDir}/**/*.js`,
    `${state.config.inputDir}/**/*.ts`,
  ]);
 
  const cssFiles = await globby(`${state.config.inputDir}/**/*.css`);
  const reactFiles = await globby([
    `${state.config.inputDir}/**/*.jsx`,
    `${state.config.inputDir}/**/*.tsx`,
  ]);

  if (overwrite && state.config.teamGit !== state.config.outputDir && `${state.config.teamGit}/${state.config.teamSrc[0]}` !== state.config.outputDir) {
    if (fs.existsSync(state.config.outputDir))
      await fs.promises.rm(state.config.outputDir, {
        recursive: true,
        force: true,
      });

    await fs.promises.mkdir(state.config.outputDir);
  }

  if (
    state.config.copyFiles &&
    (!state.config.teamGit || state.config.devMode)
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

  if (state.config.teamSrc) await readTeamIDs();

  //copyGlobalCss();

  await readMetaTags([...htmlFiles, ...jsFiles, ...reactFiles]);

  await writeCssAndHtml(
    cssFiles,
    findDomsInCache(htmlFiles),
    findDomsInCache(reactFiles),
    findDomsInCache(jsFiles)
  );

  if(state.teamGit)
  {
    try 
    {
      const status = await state.teamGit.status();
      const modifiedFiles = status.modified.length + status.created.length + status.deleted.length + status.renamed.length;
      console.log (`✏️ ${modifiedFiles} file(s) changed.`);
    }
    catch(err)
    {
      console.error('❌ Failed to check Git status:', err);
    }
  }
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
  initTeamSrc,
};
