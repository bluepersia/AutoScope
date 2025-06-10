import {globby} from 'globby';
import {state, resolveHref, resolveConfigFor, getRelativePathFrom, insertLinkIntoHead} from '../shared.js';
import fs from 'fs';
import {getAST} from './react.js';
import { parseDocument} from 'htmlparser2';

import path from 'path';





async function readMetaTags(filePaths, {metaCache, metaTagMap, domCache, astCache} = state) {
 
  const htmlContents = await Promise.all(
    filePaths.map((p) => fs.promises.readFile(p, 'utf8'))
  );

  const cssDeps = new Set();
  htmlContents.forEach(async (src, index) => {
    const filePath = filePaths[index];

    const isReact = filePath.endsWith('.jsx') || filePath.endsWith('.tsx');

    let ast;
    let dom;
    if (isReact)
    {
      ast = getAST (src);
      ast.filePath = filePath;
      ast.isAST= true;
      domCache[filePath] = ast;
    }
    else 
    {  
      dom = parseDocument(src);
      dom.filePath = filePath;
      dom.isDOM = true;
      domCache[filePath] = dom;
    }

    

    let thisMetaTags = [];
    if (!isReact) thisMetaTags = getAllScopeMetaTags(dom.children, filePath);
    else {
      thisMetaTags = ast.scopeArray || getCssFilesInSameDir (filePath).map (cssFile => ({name: 'auto-scope', content: cssFile}));
      
      async function getCssFilesInSameDir(filePath) {
        // Get the directory of the given file
        const dir = path.dirname(filePath);
      
        // Build the glob pattern for all .css files in that directory
        const pattern = path.join(dir, '*.css');
      
        // Use globby to find all matching files
        const cssFiles = await globby(pattern);
      
        return cssFiles;
      }
      
      thisMetaTags = thisMetaTags.map (tag => 
      {
        if (typeof tag === 'string')
          return {name: 'auto-scope', content: tag}
        else 
          return {name:tag.name || 'auto-scope', content:tag.content}
      }
      )
    }


   
    console.log (thisMetaTags);

    const clonedMetaTags = structuredClone(thisMetaTags);

    for (const tag of clonedMetaTags) {
      tag.scopeId = tag.name.split('auto-scope-')[1];
      tag.scopeName = path.basename(tag.content, '.css');

      tag.relativePath = resolveHref(filePath, tag.content);
 

      cssDeps.add(tag.relativePath);

      
    }

    
    metaTagMap[filePath] = clonedMetaTags;
    
    const importedCssFiles = [];
    for (const metaTag of thisMetaTags)
      importedCssFiles.push(resolveHref(filePath, (metaTag.content)));

    for (const [cssFile, doms] of Object.entries (metaCache)) {
      if (!importedCssFiles.includes(cssFile))
        metaCache[cssFile] = doms.filter((d) => d.filePath !== dom.filePath);
    }

    for (const cssFile of importedCssFiles) {
      if (!metaCache[cssFile]) metaCache[cssFile] = [];

      metaCache[cssFile] = metaCache[cssFile].filter(
        (d) => d.filePath !== dom.filePath
      );
      metaCache[cssFile].push(dom || ast);
    }

    //console.log ("Meta cache: ", metaCache);
    //console.log ("Meta tag map: ", metaTagMap);
  });

  return Array.from(cssDeps);
}

function getAllScopeMetaTags(node, filePath, result = []) {
  for (let i = 0; i < node.length; i++) {
    const child = node[i];

    if (child.name === 'meta' && child.attribs?.name?.startsWith('auto-scope')) {
      const fileName = path.basename(child.attribs.content, '.css');

      let writeRM = state.config.writeRuntimeMap;

      const cssConfig = resolveConfigFor(
        resolveHref(filePath, child.attribs.content),
        state.config,
        state.config.inputDir
      );

      writeRM = cssConfig.writeRuntimeMap;

      if (!writeRM) {
        node.splice(i, 1);
        i--; // ← Critical: adjust the index after removing
      }

      result.push(child.attribs);
    }

    if (child.children) {
      getAllScopeMetaTags(child.children, filePath, result);
    }
  }

  return result;
}

export {
    readMetaTags
}