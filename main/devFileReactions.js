import { findDomsInCache } from '../index.js';
import { readMetaTags } from './readMetaTags.js';
import {
  state,
  findHtmlDeps,
  isRestFile,
  findCssDeps,
  getHash,
  removeIdFromCacheByHash,
  removeIdFromCacheByFile
} from '../shared.js';
import { writeCssAndHtml, readGlobalCss } from './conversion.js';
import fs from 'fs';
import path from 'path';
import multimatch from 'multimatch';
import fsExtra from 'fs-extra';
import postcss from 'postcss';


async function onAdded (filePaths)
{
  for(const cssFile of filePaths.filter (file => file.endsWith ('.css')))
    await checkRename (cssFile);
}

async function onChange(filePaths) {
  const { metaCache, globalCss, config } = state;

  //const htmlFiles = filePaths.filter (p => fg.sync (inputHtml).includes (path.relative (process.cwd(), p)));
  //const cssFiles = filePaths.filter (p => fg.sync (inputCss).includes (path.relative (process.cwd(), p)));

  const matchFilePaths = filePaths.map((filePath) =>
    path.relative(process.cwd(), filePath)
  );

  const htmlFiles = multimatch(matchFilePaths, `${state.config.inputDir}/**/*.html`);
  const jsFiles = multimatch (matchFilePaths, [`${state.config.inputDir}/**/*.js`, `${state.config.inputDir}/**/*.ts`]);
  const reactFiles =  multimatch(matchFilePaths, [`${state.config.inputDir}/**/*.jsx`, `${state.config.inputDir}/**/*.tsx`]);
  let cssFiles =multimatch(matchFilePaths, `${state.config.inputDir}/**/*.css`);

 
  /*
  let cssFilesNoGlobal = cssFiles;
  if (globalCss)
  {
    const globalCssFiles = multimatch (matchFilePaths, globalCss)
    
    if (globalCssFiles.length > 0)
      await readGlobalCss ();
  
    cssFilesNoGlobal = cssFiles.filter (f => !globalCssFiles.includes (f));
  }*/
  //const restFiles = filePaths.filter((filePath) => isRestFile(filePath));
  // for (const restFile of restFiles) copyFile(restFile);

  const cssDeps = (await readMetaTags([...htmlFiles, ...jsFiles, ...reactFiles])).filter(
    (filePath) => fs.existsSync(filePath)
  );

  const htmlDeps = findHtmlDeps(cssFiles);
  const reactDeps = findHtmlDeps(cssFiles, 'ast');
  const jsDeps = findHtmlDeps (cssFiles, 'js');
  
  const domCssDeps = [...htmlDeps.map (dom => findCssDeps (dom)).flat(), ...reactDeps.map(dom => findCssDeps (dom)).flat(), ...jsDeps.map (dom => findCssDeps (dom)).flat()];


  await writeCssAndHtml(
    Array.from(new Set([...cssFiles, ...cssDeps, ...domCssDeps])),
    Array.from(new Set([...findDomsInCache(htmlFiles), ...htmlDeps])),
    Array.from(new Set([...findDomsInCache(reactFiles), ...reactDeps])),
    Array.from (new Set([...findDomsInCache(jsFiles), ...jsDeps]))
  );
}

async function copyFile(srcPath) {

  await fsExtra.copy(
    srcPath,
    `${state.config.copyDir}/${path.relative(
      getOutermostDir(srcPath),
      srcPath
    )}`,
    { overwrite: true }
  );
}

async function unlinkFile(srcPath) {
  const p = `${state.config.copyDir}/${path.relative(
    getOutermostDir(srcPath),
    srcPath
  )}`;
  if (fs.existsSync(p)) await fs.promises.unlink(p);
}

function unlink(srcPath) {
  const relativePath = path.relative(state.config.inputDir, srcPath);

  const outPath = path.join(state.config.outputDir, relativePath);

  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
}
async function onRemove(filePaths) {
  const {  metaCache, domCache, metaTagMap, mergeCssMap, config } =
    state;

  const htmlFiles = filePaths.filter((file) => file.endsWith('.html') || file.endsWith ('.js') || file.endsWith ('.ts') || file.endsWith ('.jsx') || file.endsWith ('.tsx'));
  const cssFiles = filePaths.filter((file) => file.endsWith('.css'));
  /*
  let globalCssFiles = [];
  if (globalCss)
  {
    globalCssFiles = multimatch (cssFiles, globalCss);
    if (globalCssFiles.length > 0)
      await readGlobalCss ();
  }*/
  //const restFiles = filePaths.filter((file) => isRestFile(file));

  htmlFiles.forEach((htmlFile) => unlink(htmlFile));
  cssFiles.forEach((cssFile) => {
    // delete state.runtimeMap[cssFile];
    unlink(cssFile);

    /*for (let i = 0; i < cssScopes.length; i++) {
      if (cssScopes[i] === path.basename(cssFile, '.css')) {
        cssScopes.splice(i, 1);
        break;
      }
    }*/
  });

  Object.entries(metaCache).forEach(([key, val]) => {
    metaCache[key] = val.filter((dom) => !htmlFiles.includes(dom.filePath));
  });

  for (const htmlFile of htmlFiles) delete domCache[htmlFile];

  Object.keys(metaTagMap).forEach((key) => {
    if (htmlFiles.includes(key)) delete metaTagMap[key];
  });
  const domsAffected = new Set();
  const astsAffected = new Set();
  const jsAffected = new Set();
  for (const cssFile of cssFiles) {
    const scopeName = path.basename (cssFile, '.css');
    const hash = state.scopeHashFileMap[cssFile];

    if(state.config.preserveSuffixes)
    {
      if (hash)
        await removeIdFromCacheByHash (scopeName, hash);
    }
      removeIdFromCacheByFile (scopeName, cssFile);
    

    if(hash)
    {
      state.scopeHashsMap.delete (hash);
      delete state.scopeHashFileMap[cssFile];
    }

    if (config.mergeCss && mergeCssMap[cssFile]) delete mergeCssMap[cssFile];

    if (metaCache[cssFile]) {
      for (const dom of metaCache[cssFile]) {
        if (dom.isDOM) domsAffected.add(dom);
        else if (dom.isAST) astsAffected.add(dom);
        else if (dom.isJs) jsAffected.add (dom);
      }
    }
  }

  writeCssAndHtml([], Array.from(domsAffected), Array.from(astsAffected), Array.from (jsAffected));
}

function getOutermostDir(filePath) {
  const normalized = path.normalize(filePath);
  const parts = normalized.split(path.sep).filter(Boolean);
  return parts[0]; // first directory
}

async function onChangePublic(files) {
  for (const restFile of files) {
    if (
      getOutermostDir(restFile) !== state.config.inputDir ||
      isRestFile(restFile)
    )
      copyFile(restFile);
  }
}

async function onRemovePublic(files) {
  for (const restFile of files) {
    if (
      getOutermostDir(restFile) !== state.config.inputDir ||
      isRestFile(restFile)
    )
      unlinkFile(restFile);
  }
}


async function checkRename (cssFile){
  const content = await fs.promises.readFile (cssFile, 'utf-8');

  if(!content.includes ('--id:'))
    return;

  const result = await postcss([
    (root) => {
      root.walkDecls ('--id', decl =>
      {
        if (!decl.parent.selector.startsWith (`.${path.basename(cssFile, '.css')}`))
          decl.remove ();
      }
      );
    },
  ]).process(content, { from: undefined });
  
  await fs.promises.writeFile (cssFile, result.css);

}
export { onRemove, onChange, onChangePublic, onRemovePublic, onAdded };
