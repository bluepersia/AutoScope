import path from 'path';
import crypto from 'crypto';
import fs, { realpath } from 'fs';
import * as DomUtils from 'domutils';
import multimatch from 'multimatch';
import { Text } from 'domhandler';
import os from 'os';
import { selectAll, selectOne } from "css-select";
import serializeNode from "dom-serializer";
import fg from 'fast-glob';
import { LocalStorage } from 'node-localstorage';
import { default as inquirer } from 'inquirer';
const lsPath = './local-storage';
import { globby } from 'globby';


const cwd = process.cwd();

const networkInterfaces = os.networkInterfaces ();


let inputDir;
let outputDir;
let scssFolder;
let inputCss;
let inputHtml;
let cssScopes = [];
let cssFiles;
let htmlFiles;
let devMode = false;
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
  teamSrc: null, // Scan team files for usage and only enable hash/ID if module name is already used
  teamGit: null,
  stripClasses: true, //Strip classes that are never targetted with CSS.
  flattenCombis: [], //Flatten combinators, e.g. > becomes _a_
  strictBEM: false, //Use - instead of __ after the first occurence
  flattenElements: true,
  overrideConfig: {},
  formatters: {}
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
  allCombisKeys: Object.keys(allCombis),
  metaCache,
  metaTagMap,
  domCache,
  config,
  allCombis,
  globalCss: null,
  globalCssCache: {},
  teamRepoHashMap: {},
  isCopySrc: true,
  astCache: {},
  renameCache: {},
  nameCollisions: new Set(),
  localStorage: null,
  lsPath
};


async function setConfig(cfg) {
  state.config = cfg;
}

function resolveConfigFor(filePath, baseConfig, root) {
 
  let cfg = { ...baseConfig };
  for (const [pattern, override] of Object.entries(
    baseConfig.overrideConfig || {}
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
      if ((!currObj.hash && !currObj.team))
        overwrite = true;
      else 
      {
        if(state.preserveCollidingSuffixes)
          state.nameCollisions.add (idObj.hash);
        else
          overwrite = true;
      }
    }

    if (idObj.team){
      
      if(currObj.hash && state.preserveCollidingSuffixes)
        state.nameCollisions.add (currObj.hash[0]);

      if (!(currObj.hash && state.preserveCollidingSuffixes))
        overwrite = true;
    }
    if (currObj.filePath) overwrite = true;

    if (Object.keys(currObj).length === 1 && currObj.id) overwrite = true;

    if (overwrite) { 
      if (currObj.hash && idObj.hash)
        currObj.hash.push (idObj.hash);
      else 
      arr[currIndex] = idObj;
    }

    return;
  }

  if(idObj.hash)
    idObj.hash = [idObj.hash];
  
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
  const regex = new RegExp (`-([0-9a-fA-F]{${state.local.hashLength}})$`)
  const m = first.match(regex);
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
        (obj.hash && (obj2.hash?.includes (obj.hash))) //||
        //(obj.localHash && obj2.localHash === obj.localHash)
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


  state.scopeIDsCache[scopeName] = state.scopeIDsCache[scopeName].map((obj) =>
    obj.id === id ? { id } : obj
  );
}

function getMacAddress() {
  for (const name of Object.keys(networkInterfaces)) {
    for (const net of networkInterfaces[name]) {
      if (!net.internal && net.mac !== '00:00:00:00:00:00') {
        return net.mac.replace(/:/g, ''); // Remove colons
      }
    }
  }
}


function generateCssModuleHash(fileName, attempt = 1, options = {}) {
  const { length = state.config.hashLength || 6, algorithm = 'md5' } = options;

  // Normalize to a consistent string
  const normalized = path.normalize(`${fileName + getMacAddress()}?attempt=${attempt}`);

  // Create hash
  const fullHash = crypto
    .createHash(algorithm)
    .update(normalized)
    .digest('hex');

  // Return the first `length` chars
  const hash = fullHash.slice(0, length);

  if (!/[a-zA-Z]/.test(hash) || state.scopeHashsMap.has(hash))
    return generateCssModuleHash(fileName, attempt + 1);

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
  if (pathA === pathB) return true;

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
      (el) =>
        el.name === 'link' && arePathsEqual(el.attribs.href, link, dom.outPath),
      dom.children,
      true
    )
  )
    return;
  // Find the <head> tag
  let head = DomUtils.findOne((el) => el.name === 'head', dom.children, true);

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

  if(!dom.headTags)
  dom.headTags = [];

  dom.headTags.push (linkElement);
  
  head.children.push(linkElement);
  linkElement.parent = head;

  //if (addSpace) head.children.push(new Text('\n '));
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
      !cleanPattern.includes('[') &&
      !cleanPattern.startsWith (`${dir}/`)

    // Convert to a glob pattern if it's just a filename
    const normalizedPattern = isPlainFilename
      ? path.posix.join(dir, '**', cleanPattern)
      : cleanPattern.startsWith('/') ? path.posix.join(dir, path.relative(dir, cleanPattern.slice(1)))
      : path.posix.join(dir, path.relative(dir, cleanPattern));

    return isNegated ? '!' + normalizedPattern : normalizedPattern;
  });
}

function findHtmlDeps(cssFiles, type = 'html') {
  const htmlDeps = new Set();

  for (const cssFile of cssFiles) {
    if (state.metaCache[cssFile]) {
      for (const htmlFile of state.metaCache[cssFile]) {
        if (type === 'ast' && htmlFile.isAST) htmlDeps.add(htmlFile);
        else if (type === 'html' && htmlFile.isDOM) htmlDeps.add(htmlFile);
        else if (type === 'js' && htmlFile.isJs) htmlDeps.add (htmlFile);
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
        if (!item.name.includes ('.git'))
        {
          if (containsSupportedFiles(srcPath)) {
            fs.mkdirSync(destPath, { recursive: true });
            copyRecursive(srcPath, destPath);
          }
        }
      } else if (IsSupported(srcPath) && !item.name.includes ('.DS_Store')) {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(srcPath, destPath);
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
   // console.log(`No supported files found in: ${inputDir}`);
  }
}
function isRestFile(file) {
  const baseExtensions = ['.html', '.css', '.jsx', '.tsx', '.js', '.ts'];

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

  if (!href.startsWith('./')) return href;

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

function getHasClassRegex(klass) {
  return new RegExp(`class=["'][^"']*\\b${klass}\\b[^"']*["']`);
}

function getHasClassNameRegex(klass) {
  return new RegExp(`className=["'][^"']*\\b${klass}\\b[^"']*["']`);
}




function serializeHtml (dom)
{
  const {src} = dom;

  const patches = [];

  const metas = selectAll('meta[name^="auto-scope"]', dom);

  for (const node of metas) {
    if (node.startIndex == null || node.endIndex == null) continue;
  
    let start = node.startIndex;
    let end = node.endIndex + 1;
  
    // Get the full line
    let lineStart = start;
    while (lineStart > 0 && src[lineStart - 1] !== '\n' && src[lineStart - 1] !== '\r') {
      lineStart--;
    }
  
    let lineEnd = end;
    while (lineEnd < src.length && src[lineEnd] !== '\n' && src[lineEnd] !== '\r') {
      lineEnd++;
    }
    if (src[lineEnd] === '\r' && src[lineEnd + 1] === '\n') lineEnd += 2;
    else if (src[lineEnd] === '\n' || src[lineEnd] === '\r') lineEnd++;
  
    const line = src.slice(lineStart, lineEnd);
  
    // If the line only contains the meta tag (plus optional whitespace), remove the whole line
    if (/^\s*<meta[^>]+>\s*$/i.test(line.trim()) || /^\s*<meta[^>]+\/>\s*$/i.test(line.trim())) {
      start = lineStart;
      end = lineEnd;
    }
  
    patches.push({ start, end, data: "" });
  }
  
  
  const headCloseTag = '</head>';
let insertIndex = src.indexOf(headCloseTag);

if (dom.headTags?.length > 0 && insertIndex !== -1) {
  // Find the start of the line containing </head>
  // Search backward from insertIndex to find the line start
  let lineStart = insertIndex;
  while (lineStart > 0 && src[lineStart - 1] !== '\n' && src[lineStart - 1] !== '\r') {
    lineStart--;
  }

  // Extract the line with </head>
  const closingTagLine = src.slice(lineStart, insertIndex + headCloseTag.length);

  // Match indentation (spaces or tabs) at line start
  const closingTagIndentMatch = closingTagLine.match(/^([ \t]*)<\/head>/);
  const closingTagIndent = closingTagIndentMatch ? closingTagIndentMatch[1] : '';

  // Get indent of last line inside head to indent new tags
  const beforeHeadClose = src.slice(0, insertIndex);
  const lines = beforeHeadClose.split(/\r?\n/);

// Find the last non-empty line
let lastNonEmptyLine = '';
for (let i = lines.length - 1; i >= 0; i--) {
  if (lines[i].trim() !== '') {
    lastNonEmptyLine = lines[i];
    break;
  }
}

const lastLineIndentMatch = lastNonEmptyLine.match(/^([ \t]*)/);
const insertedTagsIndent = lastLineIndentMatch ? lastLineIndentMatch[1] : '  ';

  
  const serializedTags = (dom.headTags || [])
    .map(tag => insertedTagsIndent + serializeNode(tag, { encodeEntities: false }))
    .join('\n');

    insertIndex -= closingTagIndent.length;
  const fullInsertion = serializedTags + '\n';


  patches.push({
    start: insertIndex,
    end: insertIndex,
    data: fullInsertion,
  });
}
/* ----- 2-C  ·  REWRITE class ATTRIBUTES LOSSLESSLY ----- */
const classNodes = selectAll("[class]", dom);
for (const node of classNodes) {
  if (node.startIndex == null || node.endIndex == null ) continue;
  const start = node.startIndex;
  let end = start;
  
  // Look for the end of the opening tag
  while (end < src.length && src[end] !== '>') end++;
  if (src[end - 1] === '/') end++; // handle self-closing
  end++; // include '>'
  
  // Extract just the opening tag
  const tagText = src.slice(start, end);
  
  // Match and patch only the class attribute
  const match = tagText.match(/class\s*=\s*(['"])(.*?)\1/i);
  if (!match) continue;
  
  const originalClass = match[2];
  const newClass = node.attribs.class;
  
  const needsClassUpdate = originalClass !== newClass;

  const scopeHash = node.attribs['data-scope-hash'];
  const scopeMatch = tagText.match(/data-scope-hash\s*=\s*(['"])(.*?)\1/i);
  const needsScopeHashUpdate = scopeHash && (!scopeMatch || scopeMatch[2] !== scopeHash);
  const needsScopeHashRemoval = !scopeHash && scopeMatch;
  
  const scopeAttrib = node.attribs['data-scope'];
  const scopeAttribMatch = tagText.match(/data-scope\s*=\s*(['"])(.*?)\1/i);
  const needsScopeAttribUpdate = scopeAttrib && (!scopeAttribMatch || scopeAttribMatch[2] !== scopeAttrib);
  const needsScopeAttribRemoval = !scopeAttrib && scopeAttribMatch;

  if(!needsClassUpdate && !needsScopeHashUpdate && !needsScopeAttribUpdate && !needsScopeAttribRemoval && !needsScopeHashRemoval) continue;

  let patchedTag = tagText;

  if (needsClassUpdate)
  {
    patchedTag = tagText.replace(
      match[0],
      `class=${match[1]}${newClass}${match[1]}`
    );
  }
  
  if(needsScopeHashUpdate)
  {
    if (scopeMatch)
      patchedTag = patchedTag.replace(
        scopeMatch[0],
        `data-scope-hash=${scopeMatch[1]}${scopeHash}${scopeMatch[1]}`
      );
      else {
        // Insert new data-scope-hash before closing `>`
        patchedTag = patchedTag.replace(/>$/, ` data-scope-hash="${scopeHash}">`);
      }
  }   else if (needsScopeHashRemoval)
    patchedTag = patchedTag.replace(scopeMatch[0], "").replace(/\s{2,}/g, " ").replace(/\s*>$/, ">");
  

  if (needsScopeAttribUpdate)
  {
    if (scopeAttribMatch)
      patchedTag = patchedTag.replace(
        scopeAttribMatch[0],
        `data-scope=${scopeAttribMatch[1]}${scopeAttrib}${scopeAttribMatch[1]}`
      );
      else {
        // Insert new data-scope-hash before closing `>`
        patchedTag = patchedTag.replace(/>$/, ` data-scope="${scopeAttrib}">`);
      }
  }
  else if (needsScopeAttribRemoval)
    patchedTag = patchedTag.replace(scopeAttribMatch[0], "").replace(/\s{2,}/g, " ").replace(/\s*>$/, ">");
  
  // Push patch for just the opening tag
  patches.push({
    start,
    end,
    data: patchedTag,
  });
}

/* ----- 2-C  ·  REWRITE id ATTRIBUTES LOSSLESSLY ----- */
const idNodes = selectAll("[id]", dom);
for (const node of idNodes) {
  if (node.startIndex == null || node.endIndex == null ) continue;
  const start = node.startIndex;
  let end = start;
  
  // Look for the end of the opening tag
  while (end < src.length && src[end] !== '>') end++;
  if (src[end - 1] === '/') end++; // handle self-closing
  end++; // include '>'
  
  // Extract just the opening tag
  const tagText = src.slice(start, end);
  
  // Match and patch only the class attribute
  const match = tagText.match(/id\s*=\s*(['"])(.*?)\1/i);
  if (!match) continue;
  
  const originalId = match[2];
  const newId = node.attribs.id;
  
  const needsIdUpdate = originalId !== newId;
  

  if(!needsIdUpdate) continue;

  let patchedTag = tagText.replace(
      match[0],
      `id=${match[1]}${newId}${match[1]}`
    );
  
  
  // Push patch for just the opening tag
  patches.push({
    start,
    end,
    data: patchedTag,
  });
}

/* ----- 2-C  ·  REWRITE for ATTRIBUTES LOSSLESSLY ----- */
const forNodes = selectAll("[for]", dom);
for (const node of forNodes) {
  if (node.startIndex == null || node.endIndex == null ) continue;
  const start = node.startIndex;
  let end = start;
  
  // Look for the end of the opening tag
  while (end < src.length && src[end] !== '>') end++;
  if (src[end - 1] === '/') end++; // handle self-closing
  end++; // include '>'
  
  // Extract just the opening tag
  const tagText = src.slice(start, end);
  
  // Match and patch only the class attribute
  const match = tagText.match(/for\s*=\s*(['"])(.*?)\1/i);
  if (!match) continue;
  
  const originalFor = match[2];
  const newFor = node.attribs.for;
  
  const needsForUpdate = originalFor !== newFor;

  if(!needsForUpdate) continue;

  const patchedTag = tagText.replace(
      match[0],
      `for=${match[1]}${newFor}${match[1]}`
    );
  
  
  // Push patch for just the opening tag
  patches.push({
    start,
    end,
    data: patchedTag,
  });
}


 /* ----- 2-D  ·  APPLY PATCHES LEFT-TO-RIGHT ----- */
 patches.sort((a, b) => a.start - b.start);

 let out = "";
 let pos = 0;
 for (const p of patches) {
   out += src.slice(pos, p.start) + p.data;
   pos = p.end;
 }
 out += src.slice(pos);

return out;


}

function isGitError(err) {
  return err?.git === true || /fatal:|pathspec|repository|git|Git|stash|commit/i.test(err?.message || '');
}


async function renameFile(file, content, to)
{
  const fileName = path.basename (file, '.css');

  const regex = new RegExp(`\\b(${escapedFile})(--|__|:)?\\b`, 'g');

  // Replace with the new value, preserving the suffix if it exists
  const replaced = content.replace(regex, (match, base, suffix = '') => {
    return to + suffix;
  });

  await fs.promises.writeFile (file.replace (`${fileName}.css`, `${to}.css`), replaced, 'utf-8');
  await fs.promises.unlink (file);
}

function isSelectorTargetClass (selector, targetClass)
{
  if(!selector)
    return false;
  const spl = selector.split (',').map (sel => sel.trim());
  
  return spl.find(sel => sel === targetClass) || spl.find(sel => sel.startsWith(`${targetClass}_`)) || spl.find(sel => sel.startsWith(`${targetClass}--`)) || spl.find (sel => sel.startsWith(`${targetClass}:`)) || spl.find (sel => sel.startsWith(`${targetClass} `));
}



async function getPrePullState ()
{
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
      const content = await readFileSafe(cssFile);
      const hashes = parseCssScopeHashes(content);
      scopeHashes.push(...hashes);
    }


    return {scopeHashes, allFilesBefore}
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
      //const className = m[0].slice(1);
      
      results.push({hash});
    }
  }

  return results;
}

async function readFileSafe(filepath) {
  try {
    return await fs.promises.readFile(filepath, 'utf8');
  } catch {
    return '';
  }
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
      const content = await readFileSafe(cssFile);
      const hashes = parseCssScopeHashes(content);
      scopeHashesAfter.push(...hashes);
    }
    const afterHashArr = scopeHashesAfter;

    return { afterHashArr, allFilesAfter};
  }


  async function handleFilesDeleted (myGit, allFilesBefore, allFilesAfter)
  {
    const filesDeleted = allFilesBefore
    .map((teamSrc, index) =>
      teamSrc.filter(
        (f) => !f.endsWith('.css') && !allFilesAfter[index].includes(f)
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
      return fs.existsSync(filePath)
});

  
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
          await fs.promises.unlink(fileRel);
          console.log(`Deleted file: ${fileRel}`);
        } catch (err) {
          console.warn(`Failed to delete ${fileRel}: ${err.message}`);
        }
      }
      await myGit.add (filesDeleted);
    }
  }
  }


  async function handleHashesDeleted(myGit, scopeHashes, afterHashArr)
  {
    const hashDeleted = scopeHashes
      .filter(({hash}) => !afterHashArr.find(f => f.hash === hash));

    
      if (hashDeleted.length > 0) {
        const myCssFiles = await globby(`${state.config.inputDir}/**/*.css`);
    
        const deletedFiles = [];
        
        for (const { hash} of hashDeleted) {
          for (const srcPath of myCssFiles) {
            const content = await fs.promises.readFile(srcPath, 'utf8');
            if (
              (content.includes(`--scope-hash: ${hash}`) ||
              content.includes(`--scope-hash:${hash}`))
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
                await fs.promises.unlink(deletedFile);
              } finally {
              }
            }
            await myGit.add (deletedFiles);
          }
        }
      }
  }

  async function readHashesCollided()
  {
    const cssFiles = await globby(`${state.config.inputDir}/**/*.css`);

    for(const cssFile of cssFiles)
    {
      const content = await fs.promises.readFile (cssFile, 'utf-8');

      if(content.includes ('--scope-hash'))
      {
        const hashMatch = content.match(/--scope-hash\s*:\s*([^;]+);?/);
        if (!hashMatch) continue;

        const hash = hashMatch[1].trim().split(' /*')[0];

        if (state.nameCollisions.has (hash))
          console.log (`🧬 ${cssFile} is colliding! It will have a new suffix on next build.`);
      }
    }
  }
export {
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
  prefixGlobsWithDir,
  removeIdFromCache,
  findHtmlDeps,
  copyFiles,
  isRestFile,
  findDomsInCache,
  resolveHref,
  getHasClassRegex,
  getHasClassNameRegex,
  serializeHtml,
  isGitError,
  renameFile,
  isSelectorTargetClass,
  getPrePullState,
  readFilesAfter,
  handleFilesDeleted,
  handleHashesDeleted,
  readHashesCollided
};
