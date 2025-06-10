import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import * as DomUtils from 'domutils';
import multimatch from 'multimatch';
import { Text } from 'domhandler';
import { default as render } from "dom-serializer";

let inputDir;
let outputDir;
let scssFolder;
let inputCss;
let inputHtml;
let cssScopes;
let cssFiles;
let htmlFiles;
let devMode = false;
let scopeHashsMap = {};
const scopeHashFileMap = {};
let isBusy;
let scopeIDsCache = {};
const globalCssCache = {};
//const idCachePath = `${__dirname}/IdData.json`;
let resolveClses = [];
let mergeCssMap = {};
let runtimeMap = {};
const metaCache = {};
const metaTagMap = {};
let domCache = {};

let config = {
  inputDir: 'src', // Write all your vanilla content here
  outputDir: 'dist', // This is where the converted files will be created
  dontFlatten: false, // Keep compound selectors rather than BEM-style flattening
  useNumbers: true, // Use numbers (1, 2, 3, 4) instead of hash (3d0ccd)
  dontHashFirst: true, // The first scope of a certain type doesn't get an ID or hash
  mergeCss: false, // Merge all the CSS into one file
  writeRuntimeMap: false, // Write the map needed for runtime auto-BEM
  copyFiles: false, //Copy rest of files (not html, css, jsx or tsx files)
  contextSymbol: ':', // Stop the path shortener from affecting content with this symbol in class
  teamRepo: false, // Scan team files for usage and only enable hash/ID if module name is already used
  stripClasses: true, //Strip classes that are never targetted with CSS.
  flattenCombis: [], //Flatten combinators, e.g. > becomes _a_
  strictBEM: true, //Use - instead of __ after the first occurence
  overrideConfig: {},
};
const allCombis = {
  '*': '_all',
  '>': '_a_',
  '+': '_b_',
  '~': '_c_',
  ',': '_d_',
  '|': '_e_',
};

const state = {
  inputDir,
  outputDir,
  scssFolder,
  inputCss,
  inputHtml,
  cssScopes,
  cssFiles,
  htmlFiles,
  devMode,
  scopeHashsMap: new Set(),
  variableHashes: new Set(),
  //teamRepoHashes: new Set(),
  scopeHashFileMap,
  isBusy,
  scopeIDsCache,
  globalCssCache,
  resolveClses,
  mergeCssMap,
  runtimeMap,
  allCombis,
  metaCache,
  metaTagMap,
  domCache,
  config,
  allCombis,
  globalCss: null,
  globalCssCache: {},
  teamRepoHashMap: {},
  isCopySrc: true,
  astCache: {}
};

async function setConfig(cfg) {
  state.config = cfg;
}

function resolveConfigFor(filePath, baseConfig, root) {
  let cfg = { ...baseConfig };
  for (const [pattern, override] of Object.entries(
    baseConfig.overrideConfigs || {}
  )) {
    let realPattern = prefixGlobsWithDir(pattern, state.config.inputDir);
    if (
      multimatch(
        `${state.config.inputDir}/${path.relative(root, filePath)}`,
        realPattern
      ).length > 0
    ) {
      cfg = { ...cfg, ...override };
    }
  }
  return cfg;
}

function addIdToIdCache(scopeName, idObj) {
  let arr = state.scopeIDsCache[scopeName];
  if (!arr) arr = state.scopeIDsCache[scopeName] = [];

  const currIndex = arr.findIndex((obj) => obj.id === idObj.id);
  if (currIndex !== -1) {
    let overwrite = false;
    const currObj = arr[currIndex];

    if (idObj.hash) {
      const teamTag = idObj.hash.split('-')[0];
      if (teamTag !== state.config.teamTag) overwrite = true;
      else if (!currObj.hash || currObj.teamTag === state.config.teamTag)
        overwrite = true;
    }

    if (currObj.filePath) overwrite = true;

    if (Object.keys(currObj).length === 1 && currObj.id) overwrite = true;

    if (overwrite) arr[currIndex] = idObj;

    return;
  }

  arr.push(idObj);
}

function addIdToIdCacheEnd(scopeName, idObj) {
  let arr = state.scopeIDsCache[scopeName];
  if (!arr) arr = state.scopeIDsCache[scopeName] = [];

  idObj.id = arr.length;
  arr.push(idObj);
}

function getHashFromSelector(selector) {
  // grab the very first token (split on whitespace or combinators)
  const first = selector.trim().split(/\s+|>|\+|~/)[0];
  // look for a hyphen followed by exactly 6 hex chars at the end
  const m = first.match(/-([0-9a-fA-F]{6})$/);
  return m ? m[1] : null;
}
function getNumberSuffix(str) {
  const match = str.match(/-(\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
}

function replaceLast(str, search, replacement) {
  const lastIndex = str.lastIndexOf(search);
  if (lastIndex === -1) return str;
  return (
    str.substring(0, lastIndex) +
    replacement +
    str.substring(lastIndex + search.length)
  );
}

function getGlobalCssFiles(files) {
  if (!state.config.globalCss) return [];

  return multimatch(
        files,
        prefixGlobsWithDir(state.config.globalCss, state.config.inputDir)
      );
}
function findIdFromCache(scopeName, obj) {
  return (
    state.scopeIDsCache[scopeName] &&
    state.scopeIDsCache[scopeName].find(
      (obj2) =>
        (obj.filePath && obj2.filePath === obj.filePath) ||
        (obj.hash && obj2.hash === obj.hash)
    )
  );
}

function getFreeId(scopeName) {
  const arr = state.scopeIDsCache[scopeName];
  if (!arr) return 1;

  let freeSpot = 0;
  let index = 1;
  while (!freeSpot) {
    const obj = arr.find((o) => o.id === index);

    if (!obj || (!obj.filePath && !obj.hash && !obj.global && !obj.team)) {
      freeSpot = index;
      break;
    }
    index++;
  }

  return freeSpot;
}
function removeIdFromCache(scopeName, id) {
  if (!state.scopeIDsCache[scopeName]) return;

  console.log('removed: ', id);
  state.scopeIDsCache[scopeName] = state.scopeIDsCache[scopeName].map((obj) =>
    obj.id === id ? { id } : obj
  );
}
function generateCssModuleHash(filePath, attempt = 1, options = {}) {
  const { length = state.config.hashLength || 6, algorithm = 'md5' } = options;

  // Normalize to a consistent string
  const normalized = path.normalize(
    `${filePath}?attempt=${attempt}?time=${new Date().getTime()}`
  );

  // Create hash
  const fullHash = crypto
    .createHash(algorithm)
    .update(normalized)
    .digest('hex');

  // Return the first `length` chars
  const hash = `h${attempt}`;// fullHash.slice(0, length);

  if (!/[a-zA-Z]/.test(hash) || state.scopeHashsMap.has(hash))
    return generateCssModuleHash(filePath, attempt + 1);

  /*
  if (
    state.scopeHashsMap.hasOwnProperty(fileName) &&
    state.scopeHashsMap[fileName].has(hash)
  )
    return generateCssModuleHash(filePath, fileName, attempt + 1);
*/
  return hash;
}
function arePathsEqual(pathA, pathB, rootFilePath) {

  const rootDir = path.resolve(process.cwd()); // your project root
  const rootFileDir = path.dirname(path.resolve(process.cwd(), rootFilePath)); // folder of rootFilePath

  // Helper: normalize path starting with '/' to relative if it's inside project root
  const normalizePath = (p, baseDir) => {
    if (p.startsWith('/')) {
      // Remove leading slash, treat as project-root relative path
      return path.resolve(rootDir, p.slice(1));
    }
    // If path is relative (starts with ./ or ../) resolve relative to baseDir, else relative to project root
    if (p.startsWith('./') || p.startsWith('../')) {
      return path.resolve(baseDir, p);
    }
    return path.resolve(rootDir, p);
  };

  const absoluteA = normalizePath(pathA, rootFileDir);
  const absoluteB = normalizePath(pathB, rootFileDir);

  const res = absoluteA === absoluteB;
  return res;
}
function insertLinkIntoHead(dom, link, addSpace = false) {
  const linkElement = {
    type: 'tag',
    name: 'link',
    attribs: {
      rel: 'stylesheet',
      href: link,
    },
    children: [],
  };

  if (
    DomUtils.findOne(
      (el) => el.name === 'link' && arePathsEqual (el.attribs.href, link, dom.outPath),
      dom.children,
      true
    )
  )
    return;
  // Find the <head> tag
  const head = DomUtils.findOne((el) => el.name === 'head', dom.children, true);

   // If no <head>, create one and insert it
   if (!head) {
    head = {
      type: 'tag',
      name: 'head',
      attribs: {},
      children: [],
      parent: dom,
    };

    // Find first <body> to insert before
    const bodyIndex = dom.children.findIndex((el) => el.name === 'body');
    if (bodyIndex !== -1) {
      dom.children.splice(bodyIndex, 0, head);
    } else {
      // Otherwise, insert at the start
      dom.children.unshift(head);
    }
  }

  const lastChild = head.children[head.children.length - 1];
  if (lastChild && lastChild.type === 'text' && /^\s*$/.test(lastChild.data)) {
    head.children.pop();
  }

   head.children.push(linkElement);
  linkElement.parent = head;

  if (addSpace) head.children.push(new Text('\n '));
}

function getRelativePathFrom(relativePath, from) {
  if (relativePath.startsWith('/')) {
    return relativePath.replace('/', '');
  }
  const split = relativePath.split(state.config.inputDir);
  relativePath = state.config.inputDir + split[split.length - 1];
  return relativePath;
}

function getRelativePath(file, from = state.config.inputDir) {
  file = path.relative(process.cwd(), file);
  return path.relative(from, file);
}

function prefixGlobsWithDir(patterns, dir) {
  const patternArray = Array.isArray(patterns) ? patterns : [patterns];

  return patternArray.map((pattern) => {
    const isNegated = pattern.startsWith('!');
    const cleanPattern = isNegated ? pattern.slice(1) : pattern;

    // Check if it's just a filename (no slashes or glob characters)
    const isPlainFilename =
      !cleanPattern.includes('/') &&
      !cleanPattern.includes('*') &&
      !cleanPattern.includes('?') &&
      !cleanPattern.includes('[');

    // Convert to a glob pattern if it's just a filename
    const normalizedPattern = isPlainFilename
      ? path.posix.join(dir, '**', cleanPattern)
      : path.posix.join(dir, cleanPattern);

    return isNegated ? '!' + normalizedPattern : normalizedPattern;
  });
}

function findHtmlDeps(cssFiles, ast = false) {
  const htmlDeps = new Set();
  //console.log (cssFiles);
  //console.log (Object.keys (metaCache));
  for (const cssFile of cssFiles) {
    if (state.metaCache[cssFile]) {
      for (const htmlFile of state.metaCache[cssFile]) 
      {
        if (ast && htmlFile.isAST)
          htmlDeps.add(htmlFile);
        else if (!ast && htmlFile.isDOM)
          htmlDeps.add (htmlFile); 

      }
    }
  }

  return htmlDeps;
}

function copyFiles(inputDir, outputDir) {
  function IsSupported(filePath) {
    return inputDir !== state.config.inputDir || isRestFile(filePath); // Assume this is your own file type checker
  }

  // Helper: checks if the directory (or subdirectories) contain any supported files
  function containsSupportedFiles(dir) {
    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
      const itemPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        if (containsSupportedFiles(itemPath)) {
          return true;
        }
      } else if (IsSupported(itemPath)) {
        return true;
      }
    }

    return false;
  }

  function copyRecursive(src, dest) {
    const items = fs.readdirSync(src, { withFileTypes: true });

    for (const item of items) {
      const srcPath = path.join(src, item.name);
      const destPath = path.join(dest, item.name);

      if (item.isDirectory()) {
        if (containsSupportedFiles(srcPath)) {
          fs.mkdirSync(destPath, { recursive: true });
          copyRecursive(srcPath, destPath);
        }
      } else if (IsSupported(srcPath)) {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(srcPath, destPath);
        console.log(`Copied: ${srcPath} → ${destPath}`);
      }
    }
  }

  if (!fs.existsSync(inputDir)) {
    throw new Error(`Input directory does not exist: ${inputDir}`);
  }

  if (containsSupportedFiles(inputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    copyRecursive(inputDir, outputDir);
  } else {
    console.log(`No supported files found in: ${inputDir}`);
  }
}
function isRestFile(file) {
  const baseExtensions = ['.html', '.css', '.jsx', '.tsx'];

  return !baseExtensions.includes(path.extname(file).toLowerCase());
}
function findDomsInCache(htmlFiles) {
  const result = new Set();
  for (const dom of Object.values(state.domCache)) {
    for (const htmlFile of htmlFiles) {
      if (dom.filePath === htmlFile) result.add(dom);
    }
  }

  return Array.from(result);
}
function resolveHref(filePath, href) {
  // If href is absolute (starts with "/"), return it directly
  if (href.startsWith('/')) {
    return href.replace('/', '');
  }

  if (!href.startsWith ('./'))
    return href;

  // Get the directory of filePath
  const fileDir = filePath.substring(0, filePath.lastIndexOf('/') + 1);

  // Use a dummy base URL for resolution
  const base = new URL('file:///' + fileDir);
  const resolved = new URL(href, base);

  // Return the resolved pathname relative to the root
  return resolved.pathname.startsWith('/')
    ? resolved.pathname.slice(1)
    : resolved.pathname;
}


function getHasClassRegex (klass)
{
  return new RegExp (`class=["'][^"']*\\b${klass}\\b[^"']*["']`);
}

function getHasClassNameRegex (klass)
{
  return new RegExp(`className=["'][^"']*\\b${klass}\\b[^"']*["']`)
}


export{
  state,
  setConfig,
  getNumberSuffix,
  getHashFromSelector,
  addIdToIdCache,
  addIdToIdCacheEnd,
  resolveConfigFor,
  replaceLast,
  getGlobalCssFiles,
  findIdFromCache,
  insertLinkIntoHead,
  getFreeId,
  generateCssModuleHash,
  getRelativePath,
  prefixGlobsWithDir,
  removeIdFromCache,
  findHtmlDeps,
  copyFiles,
  isRestFile,
  getRelativePathFrom,
  findDomsInCache,
  resolveHref,
  getHasClassRegex,
  getHasClassNameRegex,
};
