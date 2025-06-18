import { globby } from 'globby';
import { state, resolveHref, resolveConfigFor } from '../shared.js';
import fs from 'fs';
import { getAST } from './react.js';
import { parseDocument } from 'htmlparser2';
import { getAST as getASTJs } from "./jsParser.js";
import cloneDeep from 'lodash/cloneDeep.js';

import path from 'path';

async function readMetaTags(
  filePaths,
  { metaCache, metaTagMap, domCache } = state
) {
  const htmlContents = await Promise.all(
    filePaths.map((p) => fs.promises.readFile(p, 'utf8'))
  );

  const cssDeps = new Set();
  for(const [index, src] of htmlContents.entries ()) {
    const filePath = filePaths[index];

    const isReact = filePath.endsWith('.jsx') || filePath.endsWith('.tsx');
    const isJs = filePath.endsWith ('.js');

    let ast;
    let dom;
    let js;
    if (isReact) {
      ast = await getAST(src);
      ast.filePath = filePath;
      ast.isAST = true;
      domCache[filePath] = ast;
    } else if (isJs){
      js = await getASTJs (filePath);
      js.isJs = true;
      domCache[filePath] = js;
    }
    else {
      dom = parseDocument(src, {
        withStartIndices: true,
        withEndIndices: true,
        recognizeSelfClosing: true,
        lowerCaseTags: false,
        lowerCaseAttributeNames: false
      });
      dom.src = src;
      dom.filePath = filePath;
      dom.isDOM = true;
      domCache[filePath] = dom;
    }

    const domObj = dom || js || ast;


    async function getCssFilesInSameDir(filePath) {
      // Get the directory of the given file
      const dir = path.dirname(filePath);

      // Build the glob pattern for all .css files in that directory
      const pattern = path.join(dir, '*.css');

      // Use globby to find all matching files
      const cssFiles = await globby(pattern);

      return cssFiles.filter (file => !file.includes ('.exclude.'));
    }


    let thisMetaTags = [];
    if (!isReact) {
      if(!isJs)
        thisMetaTags = getAllScopeMetaTags(dom.children, filePath);
      else 
      {
        thisMetaTags = js.autoScopeArray || (await getCssFilesInSameDir (filePath)).map (cssFile => ({name: 'auto-scope', content: cssFile}))
        
      }
      
    }
    else {
      thisMetaTags =
        ast.scopeArray || (
        await getCssFilesInSameDir(filePath).map((cssFile) => ({
          name: 'auto-scope',
          content: cssFile,
        })));


    }

    thisMetaTags = thisMetaTags.map((tag) => {
      if (typeof tag === 'string')
        return { name: 'auto-scope', content: tag };
      else return { name: tag.name || 'auto-scope', content: tag.content };
    });

    const clonedMetaTags = cloneDeep(thisMetaTags);

    for (const tag of clonedMetaTags) {
      tag.scopeId = tag.name.split('auto-scope-')[1];
      tag.scopeName = path.basename(tag.content, '.css');

      tag.relativePath = resolveHref(filePath, tag.content);

      cssDeps.add(tag.relativePath);
    }

    metaTagMap[filePath] = clonedMetaTags;
    
    const importedCssFiles = [];
    for (const metaTag of thisMetaTags)
      importedCssFiles.push(resolveHref(filePath, metaTag.content));

    for (const [cssFile, doms] of Object.entries(metaCache)) {
      if (!importedCssFiles.includes(cssFile))
        metaCache[cssFile] = doms.filter((d) => d.filePath !== domObj.filePath);
    }

    for (const cssFile of importedCssFiles) {
      if (!metaCache[cssFile]) metaCache[cssFile] = [];

      metaCache[cssFile] = metaCache[cssFile].filter(
        (d) => d.filePath !== domObj.filePath
      );
      metaCache[cssFile].push(domObj);
    }


  };

  return Array.from(cssDeps);
}

function getAllScopeMetaTags(node, filePath, result = []) {
  for (let i = 0; i < node.length; i++) {
    const child = node[i];

    if (
      child.name === 'meta' &&
      child.attribs?.name?.startsWith('auto-scope')
    ) {
      const fileName = path.basename(child.attribs.content, '.css');

      let writeRM = state.config.writeRuntimeMap;

      const cssConfig = resolveConfigFor(
        resolveHref(filePath, child.attribs.content),
        state.config,
        state.config.inputDir
      );

      /*
      writeRM = cssConfig.writeRuntimeMap;

      if (!writeRM) {
        node.splice(i, 1);
        i--; // ← Critical: adjust the index after removing
      }*/

      result.push(child.attribs);
    }

    if (child.children) {
      getAllScopeMetaTags(child.children, filePath, result);
    }
  }

  return result;
}

export { readMetaTags };
