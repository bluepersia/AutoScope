import {
  state,
  findDomsInCache,
  replaceLast,
  getHasClassNameRegex,
  getHasClassRegex,
  resolveConfigFor,
  getNumberSuffix,
  addIdToIdCache,
  serializeHtml,
  findHtmlDeps
} from '../shared.js';
import { writeCssAndHtml } from './conversion.js';
import { readMetaTags } from './readMetaTags.js';
import { getAST, writeToAST } from './react.js';
import {getAST as getASTJs, writeToAST as writeToASTJs} from './jsParser.js';
import fs from 'fs';
import path from 'path';
import postcss from 'postcss';
import { parseDocument, DomUtils } from 'htmlparser2';
import * as cssSelect from 'css-select';
import { globby } from 'globby';
import { default as serialize } from 'dom-serializer';
import cloneDeep from 'lodash/cloneDeep.js'
import simpleGit from 'simple-git';

const git = simpleGit(process.cwd());

import { Element } from 'domhandler';

async function syncTeamRepo(
  config,
  strip = [],
  fork = null,
  syncRepo = config.teamGit
) {
  const srcRoot = config.inputDir;

  //Backup
  await git.add([`${srcRoot}/**/*`]);
  await git.commit('Pre-sync backup');
  async function tagExists(tagName) {
    const tags = await git.tags(); // returns { all: [...], latest: '...' }
    return tags.all.includes(tagName);
  }
  if (await tagExists ('sync-backup'))
    await git.tag(['-d', 'sync-backup']);
  await git.tag(['sync-backup']);

  state.resolveClses = strip;
  let myHashes = new Set();
  if (!fork) {
    /*
  if (config.globalCss) {
    const globalCssFiles = await globby(
      prefixGlobsWithDir(config.globalCss, config.inputDir)
    );
    for (const globalCssFile of globalCssFiles)
      await fs.promises.unlink(globalCssFile);
  }

  copyGlobalCss(config.outputDir, config.inputDir); */
  }

  const teamCss = `${syncRepo}/**/*.css`;
  const deletedFiles = [];

  const cssFiles = await globby(teamCss);

  const htmlFiles = await Promise.all(
    state.config.teamSrc.map(
      async (src) => await globby(`${state.config.teamGit}/${src}/**/*.html`)
    )
  );
  const jsFiles = await Promise.all(
    state.config.teamSrc.map(
      async (src) => await globby([`${state.config.teamGit}/${src}/**/*.js`, `${state.config.teamGit}/${src}/**/*.ts`])
    )
  );

  const reactFiles = await Promise.all(
    state.config.teamSrc.map(
      async (src) =>
        await globby([
          `${state.config.teamGit}/${src}/**/*.jsx`,
          `${state.config.teamGit}/${src}/**/*.tsx`,
        ])
    )
  );
  let srcCssFiles = await globby(`${state.config.inputDir}/**/*.css`);
  const outputScopes = [];

  const outputs = [];

  const stripData = { htmlDeps: [], reactDeps: [], jsDeps: [] };

  await readAndWriteCss();

  const allScopeClasses = outputScopes.map(({ scopeSelector }) =>
    // e.g. ".recipe-page-234ffb" → "recipe-page-234ffb"
    scopeSelector.slice(1)
  );

  await readAndWriteHtml();
  await readAndWriteJs ();
  await readAndWriteReact();

  function makeScopeRegexGlobal(scopeSelector) {
    const esc = scopeSelector.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    return new RegExp(`${esc}(?=$|[^0-9A-Za-z])`, 'g'); // global replace
  }

  function makeScopeRegexFirstThenEmpty(scopeSelector) {
    const esc = scopeSelector.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    return new RegExp(`${esc}(?=$|[^0-9A-Za-z])`, 'g'); // global, but replacer will handle logic
  }

  function unflatten(selector, localConfig) {
    if (localConfig.dontFlatten) {
      return selector;
    }

    // Replace combinators in combination keys

    for (const [key, entry] of Object.entries(state.allCombis)) {
      if (
        localConfig.flattenCombis === true ||
        (Array.isArray(localConfig.flattenCombis) &&
          localConfig.flattenCombis.includes(key))
      ) {
        selector = selector.replace(entry, ` ${key} .`);
      }
    }
    const segs = selector.split(' ');

    for (let [index, seg] of segs.entries()) {
      // If selector contains '__', split by '__' and join with spaces
      if (seg.includes('__')) {
        // Split selector on '__' and trim each part
        const parts = seg.split('__').map((s) => s.trim());

        // Prefix every part that is not a combinator or special char with dot (.)
        // We only want to prefix class selectors, not combinators or element selectors
        // We can assume combinators contain spaces or special chars like *, >, +, etc
    
        const prefixWithDot = (part) => {
          // If part already starts with a dot or special combinator char, keep as is
          if (
            part.startsWith('.') ||
            ['*', '>', '+', '~', ',', '|'].some((ch) => part.startsWith(ch)) ||
            part === ''
          ) {
            return part;
          }
          // Otherwise, prefix dot
          return '.' + part;
        };

        // Rebuild selector joining parts with spaces
        seg = parts.slice(1).map(prefixWithDot).join(' ');
      } else {
        // If no '__' splitting, just prefix dot if not present and not combinator
        if (
          !seg.startsWith('.') &&
          !['*', '>', '+', '~', ',', '|'].some((ch) => seg.startsWith(ch)) && seg.trim() !== ''
        ) {
          seg = '.' + seg;
        }
      }

      segs[index] = seg;
    }
    return segs.join(' ');
  }

  async function readAndWriteCss() {
    let scopes = [];
    const duplicateHashes = new Set();

    for (const teamPath of cssFiles) {
      const css = await fs.promises.readFile(teamPath, 'utf-8');
      let root;
      try {
       root = postcss.parse(css, { from: teamPath });
      }catch(err)
      {
        console.error(`[Syntax Error] Failed to parse file: ${teamPath}`);
        console.error(err.message);
        continue;
      }
      root.walkRules((rule) => {
        rule.walkDecls('--scope-hash', (decl) => {
          const sel = rule.selector.trim();
          const hash = decl.value.split(' ')[0].trim();

          let className = sel.replaceAll('.', '');

          if (strip.length > 0) {
            if (!strip.includes(className)) return;
          }
          const scopeName = className.replace(/-\w+$/, '');

          const ruleIndex = root.nodes.indexOf(rule);
          const adjacentRules = [];

          for (let i = ruleIndex - 1; i >= 0; i--) {
            const rule = root.nodes[i];
            if (rule.selector?.startsWith(sel)) adjacentRules.unshift(rule);
            else break;
          }

          adjacentRules.push(root.nodes[ruleIndex]);

          for (let i = ruleIndex + 1; i < root.nodes.length; i++) {
            const rule = root.nodes[i];
            if (rule.selector?.startsWith(sel)) {
              adjacentRules.push(rule);
            } else if (rule.type !== 'rule') {
              adjacentRules.push(rule);
              if (rule.name === 'media') adjacentRules.push(...rule.nodes);
            } else break;
          }

          if (hash && (!fork || fork === hash)) {

            if (scopes.find (s => s.hash === hash))
              duplicateHashes.add (hash);

            scopes.push({
              scopeSelector: sel,
              hash,
              teamCssPath: teamPath,
              scopeName,
              className,
              adjacentRules,
            });
          }
        });
      });
    }

    

    for (const {
      scopeSelector,
      hash,
      teamCssPath,
      scopeName,
      className,
      adjacentRules,
    } of scopes) {
      let outPath = null;

      for (const srcPath of srcCssFiles) {
        const content = await fs.promises.readFile(srcPath, 'utf8');

        if (
          content.includes(`--scope-hash: ${hash}`) ||
          content.includes(`--scope-hash:${hash}`)
        ) {
          if (duplicateHashes.has (hash))
          {
            let errorMsg = `💥 Hash conflict! Syncing cancelled to prevent fatal overwrites.`;

            const scopesWithHash = scopes.filter (s => s.hash === hash);
            const classNames = new Set();
            for (const scope of scopesWithHash)
            {
              classNames.add (scope.className);
            }
            errorMsg += '\n';
            
            if (classNames.size === scopesWithHash.length)
              errorMsg += '🎯 You may use npx resolve to fix this.'
            else 
              errorMsg += `❗Duplicate class names using same hash. Do not use npx resolve. Instead, remove the hash in your src, then generate new one. Replace the hash in team repo with new one.`;
       

            throw Error (errorMsg);
          }
          myHashes.add (hash);
          outPath = srcPath.replace(path.basename(srcPath), `${scopeName}.css`);
          break;
        }
      }

      if (!outPath) {
        //        const rel = path.relative(teamRepo, teamCssPath);

        //      outPath = path.join(srcRoot, rel);
        continue;
      }

      if (strip.length > 0) stripData.filePath = outPath;

      const css = await fs.promises.readFile(teamCssPath, 'utf8');

      const root = postcss.parse(css, { from: teamCssPath });
      const localConfig = resolveConfigFor(outPath, config, config.inputDir);

      let extracted = [];
      const scopeClass = scopeSelector.slice(1);
      const baseClass = scopeClass.replace(/-\w+$/, ''); // Remove hash or numeric suffix
      let scopeRegex;

      if (localConfig.dontFlatten) {
        // Replace all occurrences with .baseClass
        scopeRegex = makeScopeRegexGlobal(scopeSelector);
      } else {
        // Replace first occurrence with .baseClass, all others with ""
        scopeRegex = makeScopeRegexFirstThenEmpty(scopeSelector);
      }

      adjacentRules.forEach((rule) => {
        const isKeyframes = rule.name === 'keyframes';

        const isMedia = !isKeyframes && rule.name === 'media';

        if (isKeyframes) {
          const oldName = rule.params;
          const newName = oldName.split('__').at(-1);
          rule.params = newName;

          // Then update all usages of this animation name in declarations:
          adjacentRules.forEach((rule) =>
            rule.walkDecls((decl) => {
              // Check if decl contains animation or animation-name
              if (
                decl.prop === 'animation-name' ||
                decl.prop === 'animation' // animation shorthand includes name
              ) {
                // Replace oldName with newName in the value
                decl.value = decl.value.replace(
                  new RegExp(`\\b${oldName}\\b`, 'g'),
                  newName
                );
              }
            })
          );
          extracted.push(rule);
          return;
        } else if (isMedia) {
          extracted.push(rule);
          return;
        }

        const originalSelector = rule.selector;

        // Rule must start with full scope selector (e.g. ".recipe-page-234ffb")
        const sels = originalSelector.split(',').map((s) => s.trim());
        const matchesAll = sels.some((sel) => sel.startsWith(scopeSelector));

        if (!matchesAll) return;

        if (strip.length > 0) {
          const hasScopeHash = rule.nodes?.some(
            (n) => n.type === 'decl' && n.prop === '--scope-hash'
          );

          if (hasScopeHash) {
            const newDecl = postcss.decl({
              prop: '--resolve-collision',
              value: true,
            });

            rule.append(newDecl);
          }
        }

        let newSelector;
        if (localConfig.dontFlatten)
          newSelector = originalSelector.replace(scopeRegex, `.${baseClass}`);
        else {
          let firstFound = false;
          newSelector = originalSelector.replace(scopeRegex, (match) => {
            if (!firstFound) {
              firstFound = true;
              return `.${baseClass}`;
            }
            return ''; // Remove duplicates after first occurrence
          });
          // Then apply unflatten as usual
          newSelector = unflatten(newSelector, localConfig);
        }

        rule.selector = newSelector;

        if (!(rule.parent?.type === 'atrule' && rule.parent.name === 'media'))
          extracted.push(rule);
      });
      extracted = extracted.map((e) => (e.name === 'media' ? e.clone() : e));

      if (extracted.length === 0) continue;

      outputs.push({
        outPath,
        output: extracted.map((e, index) => (index > 0 ? e.raws.before : '') + e.toString() + e.raws.after).join(''),
      });

      outputScopes.push({
        scopeSelector,
        baseClass,
        outPath,
        klass: scopeSelector.slice(1),
      });
    }

    return outputScopes;
  }

  async function readAndWriteHtml() {
    for (const srcHtmlFiles of htmlFiles) {
      for (const htmlPath of srcHtmlFiles) {
        const outPath = path.join(
          srcRoot,
          path.relative(
            htmlFiles.length <= 1
              ? `${state.config.teamGit}/${state.config.teamSrc[0]}`
              : state.config.teamGit,
            htmlPath
          )
        );

        const html = await fs.promises.readFile(htmlPath, 'utf8');

        let hasClass = false;
        for (const hash of myHashes) {
          if (html.includes (`data-scope-hash="${hash}"`)) {
            hasClass = true;
            break;
          }
        }
        if (!hasClass) continue;


        let dom;
        try {
          dom = await readAndWriteDom(
            parseDocument(html, {
              withStartIndices: true,
              withEndIndices: true,
              recognizeSelfClosing: true,
              lowerCaseTags: false,
              lowerCaseAttributeNames: false
            })
          );
        }catch(err)
        {
          console.error(`[Syntax Error] Failed to parse file: ${htmlPath}`);
          console.error(err.message);
          continue;
        }

        stripData.htmlDeps.push(outPath);
        dom.src = html;
        outputs.push({
          outPath,
          output: serializeHtml(dom),
        });
      }
    }
  }
  async function readAndWriteJs() {
    for (const srcJsFiles of jsFiles) {
      for (const jsPath of srcJsFiles) {
        const outPath = path.join(
          srcRoot,
          path.relative(
            jsFiles.length <= 1
              ? `${state.config.teamGit}/${state.config.teamSrc[0]}`
              : state.config.teamGit,
            jsPath
          )
        );

        let js;
        try {
          js = await getASTJs (jsPath); 
        }catch(err)
        {
          console.error(`[Syntax Error] Failed to parse file: ${jsPath}`);
          console.error(err.message);
          continue;
        }
        let hasClass = false;
        for (const hash of myHashes) {
          if (js.raw.includes (`data-scope-hash="${hash}"`)) {
            hasClass = true;
            break;
          }
        }
        if (!hasClass) continue;

        stripData.jsDeps.push(outPath);

        js.domClones = cloneDeep (js.doms);
        for (const dom of js.domClones) await readAndWriteDom(dom.dom);

        outputs.push({
          outPath,
          output: await writeToASTJs (js),
        });
      }
    }
  }
  function unflattenHtmlClass(className, localConfig) {
    if (localConfig.dontFlatten) {
      return className;
    }

    for (const flat of Object.values (state.allCombis))
      if (className.includes (flat))
        className = className.replace (flat, '__');

    if (className.includes('__')) {
      const parts = className.split('__');
      // Apply only the last piece after last '__'
      return parts[parts.length - 1];
    }
    return className;
  }
  async function readAndWriteDom(dom) {
    const usedScopes = [];

    function selectOuterUnscopedNodes(dom, outputScopes) {
      const scopePrefixes = outputScopes.map(({ klass }) => klass);

      const results = [];

      function isMyKlass(cls) {
        return scopePrefixes.some(
          (val) => cls === val || cls.startsWith(`${val}_`)
        );
      }
      function processNode(node, currBreak = false, myScope = null) {
        if (!node.attribs?.class) {
          for (const child of node.children || [])
            processNode(child, currBreak, myScope);
          return;
        }

        const classes = node.attribs.class
          .trim()
          .split(/\s+/)
          .filter((cls) => !cls.startsWith('$') && !cls.includes ('__EXPR'));

        
        const scopeHash = node.attribs?.['data-scope-hash'] || '';
    
        let isMyScope;
        if(scopeHash)
        {
        if (myHashes.has (scopeHash)) 
        {
          myScope = { class: node.attribs.class.split (' ')[0], hash:scopeHash}
          isMyScope = true;
          currBreak = false;
        }
        else 
          myScope = null;
      } 

        if (!myScope)
        {
          if (!currBreak)
          {
            results.push ({node, allInvalid:true});
            currBreak = true;
          }
        }
        else 
        {
          if (isMyScope)
          {
            if (classes.some (cls => !cls.startsWith (myScope.class)))
            {
              results.push ({node, exclude: classes.filter (cls => !cls.startsWith (myScope.class))})
            }
          }
          else 
          {
            if (!classes[0].startsWith (`${myScope.class}_`))
            {
              if (!currBreak)
              {
                const invalidArr = classes.filter (cls => !cls.startsWith (`${myScope.class}_`));
                if (invalidArr.length === classes.length)
                  results.push ({node, allInvalid:true })
                else 
                  results.push ({node, invalid:invalidArr})
                currBreak = true;
              }
            } else if (classes.some (cls => !cls.startsWith (`${myScope.class}_`)))
            {
              results.push ({node, exclude: classes.filter (cls => !cls.startsWith (`${myScope.class}_`))})
            }
            else if (classes.some (cls => cls === myScope.class) && !isMyScope)
            {
              if (!currBreak)
              {
                const invalidArr = classes.filter (cls => !cls.startsWith (`${myScope.class}_`) || cls === myScope.class);
                if(invalidArr.length === classes)
                  results.push ({node, allInvalid:true})
                else
                  results.push ({node, invalid:invalidArr})
                
                currBreak = true;
              }
              myScope = null;
            }
        }
        }


        for (const child of node.children || []) processNode(child, currBreak, myScope);
      }

      processNode(dom);

      return results;
    }

    /*
    const notMine = selectOuterUnscopedNodes(dom, outputScopes);

    for (const { node, allInvalid, invalid, exclude, excludeAll } of notMine) {
      if (excludeAll) node.attribs['data-exclude'] = '';
      else if (exclude) node.attribs['data-exclude'] = exclude.join(',');
      else if (allInvalid) node.attribs['data-break'] = '';
      else node.attribs['data-break'] = invalid.join(',');
    }*/
    const baseClassMap = {}
    for (const [
      i,
      { scopeSelector, baseClass, outPath, klass },
    ] of outputScopes.entries()) {
      const localConfig = resolveConfigFor(outPath, config, config.inputDir);

      let foundExact = false;

      let baseClassCount;
      if (!baseClassMap[baseClass])
        baseClassMap[baseClass] = 0;
      
      baseClassMap[baseClass]++;

      baseClassCount = baseClassMap[baseClass];

      let nodes = cssSelect.selectAll (elem => {
        if (!elem.attribs || !elem.attribs.class) return false;
        return elem.attribs.class.split (' ').includes (klass) && elem.attribs['data-scope-hash'] && myHashes.has (elem.attribs['data-scope-hash']);
      }, dom);


      function processNode (node, isParent = true)
      {
        if (node.attribs?.id && node.attribs.id.startsWith (`${klass}__`))
            node.attribs.id = node.attribs.id.split ('__').at (-1);
        
          if (node.attribs?.for && node.attribs.for.startsWith (`${klass}__`))
            node.attribs.for = node.attribs.for.split ('__').at (-1);

        if (!node.attribs?.class)
        {
          if(node.children)
          node.children.forEach (node => processNode (node, false));
          return;
        }
        const classTokens = node.attribs.class.split(/\s+/);

        let isNewScope = false;


        if (!isParent && node.attribs['data-scope-hash'])
          isNewScope = true;


        if (classTokens.includes (klass) && !isParent)
          isNewScope = true;

        /*
        if(node.attribs['data-scope-hash'])
          inBreak = false;

        const notKlassArr = classTokens.filter (cls => cls !== klass && !cls.startsWith (`${klass}_`) && !cls.startsWith (`${klass}--`))
        
        if(notKlassArr.length > 0 && !inBreak)
        {
          if(node.children?.some (child => child.attribs?.class.split (/\s+/).every (cls => !cls.startsWith (`${klass}_`))))
          {
            node.attribs['data-break'] = notKlassArr.length === classTokens.length ? '' : notKlassArr.join (' ');
            inBreak = true;
          }
          else 
          {
            node.attribs['data-exclude'] = notKlassArr.length === classTokens.length ? '' : notKlassArr.join (' ');
          }
        }*/
        

        let updated = false;
        let exactMatch = false;
        const newTokens = classTokens.map((token) => {
       
          if (token === klass) {
            if (isNewScope)
              return token;
            
              exactMatch = true;
              updated = true;
              return baseClass;
          } else if (token.startsWith(`${klass}_`) || (!isNewScope && token.startsWith (`${klass}--`))) {
            
            updated = true;
            let replaced = token.replace(`${klass}_`, `${baseClass}_`).replace (`${klass}--`, `${baseClass}--`);
            if (!localConfig.dontFlatten) {
              replaced = unflattenHtmlClass(replaced, localConfig);
              replaced = getLastClassPiece(replaced);
            }
            return replaced;
          }
          return token;
        });

        if (updated) {
          node.attribs.class = Array.from (new Set (newTokens)).join(' ');
        }

        if (exactMatch) {
          if(baseClassCount > 1)
            node.attribs['data-scope'] = String(baseClassCount);

          foundExact = true;
        }

       if (isNewScope)
        return;
        
        if(node.children)
        node.children.forEach (child => processNode (child,false));
      }
      nodes.forEach((node) => {
        
        processNode (node, node.attribs['data-scope-hash']);

        delete node.attribs['data-scope-hash'];
      });

      if (foundExact) {
        usedScopes.push({
          name: baseClassCount <= 1 ? 'auto-scope' : `auto-scope-${baseClassCount}`,
          content: outPath,
          localConfig,
        });
      }
      
    }

    if (usedScopes.length > 0) {
      const head = cssSelect.selectAll('head', dom)[0];
      if (head) {
        for (const { name, content, localConfig } of usedScopes) {
          if (localConfig.writeRuntimeMap) continue;

          const link = new Element('meta', { name, content });

          head.children.push(link);
          dom.headTags = dom.headTags || [];
          dom.headTags.push (link);
          //head.children.push(new Text('\n '));
        }

        if (config.mergeCss)
          head.children = head.children.filter(
            (c) =>
              !c.attribs?.href ||
              path.basename(c.attribs.href, '.css') !==
                path.basename(config.mergeCss, '.css')
          );
      }
    }

    return dom;
  }

  function getLastClassPiece(className) {
    const parts = className.split('__');
    return parts[parts.length - 1];
  }
  async function readAndWriteReact() {
    for (const srcFiles of reactFiles)
      for (const file of srcFiles) {
        const code = await fs.promises.readFile(file, 'utf8');
        const outPath = path.join(
          srcRoot,
          path.relative(
            reactFiles.length <= 1
              ? `${state.config.teamGit}/${state.config.teamSrc[0]}`
              : state.config.teamGit,
            file
          )
        );
        let hasClass = false;
        for (const hash of myHashes) {
          if (code.includes (`data-scope-hash="${hash}"`)) {
            hasClass = true;
            break;
          }
        }

        if (!hasClass) return;

        let ast;
        try {
          ast = await getAST(file);
        } catch(err)
        {
          console.error(`[Syntax Error] Failed to parse file: ${file}`);
          console.error(err.message);
          continue;
        }
        reactDeps.push(outPath);

        for (const dom of ast.doms) readAndWriteDom(dom);

        replaceLinkStylesheetsWithImports(ast);
        const out = await writeToAST(ast);
        outputs.push({ outPath, output: out });
      }
  }

  async function download() {
    for (const { outPath, output } of outputs) {
      await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
      const out = outPath.endsWith('.html')
        ? await state.htmlFormatter(output)
        : outPath.endsWith('.css')
        ? await state.cssFormatter(output)
        : outPath.endsWith('.jsx')
        ? await state.jsxFormatter(output) 
        : output.endsWith ('.js') ?
        await state.jsFormatter (output) :
        output.endsWith ('.tsx') ? 
        await state.tsxFormatter (output) :
        output.endsWith ('.ts') ?
         await state.tsFormatter(output) : output;
      await fs.promises.writeFile(outPath, out);
    }
  }

  try {
    const data = await fetch('http://localhost:3012/read-team');
  } catch (err) {}

  await download();

  if (stripData.filePath) {
    let json = JSON.stringify(stripData);

    try {
      const res = await fetch('http://localhost:3012/resolve-build', {
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
        body: json,
      });
    } catch (err) {

      try {
     await readMetaTags([
        ...stripData.htmlDeps,
        ...stripData.jsDeps,
        ...stripData.reactDeps,
      ]);
      const css = [stripData.filePath];

      
      await writeCssAndHtml(
        css,
        findDomsInCache(stripData.htmlDeps),
        findDomsInCache(stripData.reactDeps),
        findDomsInCache (stripData.jsDeps)
      );
    }
    catch(err)
    {
      console.error (err);
    }
    } finally {
      return;
    }
  }
  /*
if (postBuild)
{
  try {
    const req = http.request(
      {
        hostname: 'localhost',
        port: 3012,
        path: postBuild,
        method: 'POST',
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', async () => {
         
        });
      }
    );

    req.on('error', async (err) => {
       
    });

    req.end();
  } finally {
  }
}*/
}

function clearTeamFromIDCache() {
  for (const [key, arr] of Object.entries(state.scopeIDsCache))
    state.scopeIDsCache[key] = arr.filter((obj) => !obj.hash && !obj.team);

  //state.scopeHashsMap = new Set (Array.from (state.scopeHashsMap).filter (h => !state.teamRepoHashMap.has (h)));
  //state.teamRepoHashMap = new Set();
}

async function readTeamIDs() {
  let mode;

  const { config, scopeHashsMap } = state;

  const teamCssFiles = await globby(
    config.teamSrc.map((src) => `${config.teamGit}/${src}/**/*.css`)
  );

  // const cssFiles = config.globalCss ? teamCssFiles.filter (cssFile => multimatch (cssFile, prefixGlobsWithDir (config.globalCss, outputDir)).length <= 0) : teamCssFiles

  clearTeamFromIDCache();

  for (const file of teamCssFiles) {
    const teamCss = await fs.promises.readFile(file, 'utf8');

    await postcss([
      (root) => {
        root.walkRules((rule) => {
          if (rule.selector) {
            const selectors = rule.selector
              .split(',')
              .filter((s) => !s.includes('__'));

            selectors.forEach((selector) => {
              const className = selector.replaceAll('.', '');
              //if (state.resolveClses.includes (className))
              //return;

              let hashLink;
              rule.walkDecls((decl) => {
                if (decl.prop === '--scope-hash') {
                  hashLink = decl.value.split(' ')[0].trim();
                  return false;
                }
              });
              if (hashLink) {
                const numberSuffix = getNumberSuffix(selector);
                const hash = hashLink;
                const hashSuffix = selector.endsWith(hash) ? hash : '';

                const suffix = numberSuffix || hashSuffix;

                const scopeName = suffix
                  ? replaceLast(className, `-${suffix}`, '')
                  : className;

                /*
                  if (!scopeHashsMap[scopeName])
                    scopeHashsMap[scopeName] = new Set ();
  
                  scopeHashsMap[scopeName].add(hash);*/

                state.scopeHashsMap.add(hash);
                //state.teamRepoHashes.add (hash);

                /*if(!state.variableHashes[scopeName])
                    state.variableHashes[scopeName] = new Set ();
                  
                  state.variableHashes[scopeName].add (hashLink);
                  state.variableHashes[scopeName].add (hash);*/

                const objAdd = {
                  hash: hashLink,
                  suffix: hashSuffix || numberSuffix,
                };

                if (numberSuffix) {
                  objAdd.id = numberSuffix;

                  addIdToIdCache(scopeName, objAdd);
                } else if (!hashSuffix) {
                  objAdd.id = 1;
                  addIdToIdCache(scopeName, objAdd);
                }

                return;
              }

              const numberSuffix = getNumberSuffix(selector);

              /*
               if(numberSuffix)
               {
               
                state.scopeHashsMap.add (String(numberSuffix));
                state.teamRepoHashMap.add (String (numberSuffix));
                console.log (state.scopeHashsMap);
                
                
               }*/

              const scopeName = numberSuffix
                ? replaceLast(className, `-${numberSuffix}`, '')
                : className;

              const objAdd = { id: numberSuffix || 1, team: true };

              addIdToIdCache(scopeName, objAdd);
            });
          }
        });
      },
    ]).process(teamCss, { from: undefined });
  }
  //let containsScope = false;

  //if (!scopeHashsMap.hasOwnProperty(scopeName))
  //  scopeHashsMap[scopeName] = new Set();

  /*   root.walkRules((rule) => {
            //if (containsScope) return;

            /*
              if (rule.type === 'comment' && rule.text.trim().startsWith ('@exclude'))
              {
                pendingMeta = rule.text.replace ('@exclude', '').trim ();
              }
              else if (rule.selector)
              {
                if (pendingMeta)
                {
                  if (rule.selector.startsWith (`.${pendingMeta}`))
                    return;
                  else
                    pendingMeta = null;
                }

            if (rule.selector) {
              const selectors = rule.selector.split (',').filter (s => !s.includes ('__') && !hashLinkSelectors.has (s))
              selectors.forEach (selector => {
              
              
                for (const scopeName of state.cssScopes) {

                  if (!selector.startsWith (`.${scopeName}`))
                    continue;
              /*
              function testIsolatedValue(input, value) {
                const escapedValue = escapeRegex(value);
                const pattern = new RegExp(`(^| )${escapedValue}($| )`);
                return pattern.test(input);
              }


              if (!containsScope && testIsolatedValue (rule.selector, `.${scopeName}`))
                {
                  if (!teamIDsUsed[scopeName])
                    teamIDsUsed[scopeName] = [];

                  if (!teamIDsUsed[scopeName].includes (file))
                    teamIDsUsed[scopeName].push (file);

                  containsScope = true;
                  }
          

              function getIdForSelector(selector, inputStr) {
                inputStr = `.${inputStr}`;
                // Escape regex-significant chars in inputStr
                const esc = inputStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                // Match start: inputStr optionally -digits, then end or whitespace
                const regex = new RegExp(`^${esc}(?:-(\\d+))?(?=\\s|$)`);
                const m = selector.match(regex);
                if (!m) return 0; // no match at all
                return m[1]
                  ? parseInt(m[1], 10) // matched with suffix → return that number
                  : 1; // matched exactly without suffix
              }

              const id = getIdForSelector(selector, scopeName);
             
             
              if (id)
                addIdToIdCache (scopeName, {id, team:true});

              /*if (
                !scopeIDsMap.hasOwnProperty(scopeName) ||
                id > scopeIDsMap[scopeName]
              )
                scopeIDsMap[scopeName] = id;

              
              const hash = getHashFromSelector(selector);

              if (hash) 
              {
                if (!scopeHashsMap[scopeName])
                  scopeHashsMap[scopeName] = new Set ();

                scopeHashsMap[scopeName].add(hash);
                
              }

              if (!id && !hash)
                addIdToIdCache (scopeName, {team:true, id:1})
            }
            
          })
      
          };
          /*
            if (!containsScope)
            {
              if (teamIDsUsed[scopeName].includes (file))
                teamIDsUsed[scopeName] = teamIDsUsed[scopeName].filter (f => f !== file);
            }
            
        })
      },
    ]).process(teamCss, { from: undefined });
  }
*/
}

export { syncTeamRepo, readTeamIDs };
