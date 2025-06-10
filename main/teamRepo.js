import {
  state,
  findDomsInCache,
  replaceLast,
  getHasClassNameRegex,
  getHasClassRegex,
  addIdToIdCacheEnd,
  resolveConfigFor,
  getNumberSuffix,
  getHashFromSelector,
  addIdToIdCache,
} from '../shared.js';
import { writeCssAndHtml } from './conversion.js';
import { readMetaTags } from './readMetaTags.js';
import { getAST, writeToAST } from './react.js';
import fs from 'fs';
import path from 'path';
import postcss from 'postcss';
import { parseDocument, DomUtils } from 'htmlparser2';
import * as cssSelect from 'css-select';
import { globby } from 'globby';
import { default as serialize } from 'dom-serializer';
import http from 'http';
import { default as inquirer } from 'inquirer';
import * as domUtils from 'domutils';

import simpleGit from 'simple-git';

const git = simpleGit(process.cwd());

import { Element, Text } from 'domhandler';

async function syncTeamRepo(
  config,
  strip = [],
  fork = null,
  syncRepo = config.teamRepo
) {
  //Backup
  await git.add('.');
  await git.commit('Pre-sync backup', [], { '--allow-empty': null });

  state.resolveClses = strip;

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
  const teamHtml = `${syncRepo}/**/*.html`;
  const teamReact = [`${syncRepo}/**/*.jsx`, `${syncRepo}/**/*.tsx`];
  const srcRoot = config.inputDir;
  const deletedFiles = [];

  const cssFiles = await globby(teamCss);

  const htmlFiles = await globby(teamHtml);
  const reactFiles = await globby(teamReact);
  let srcCssFiles = await globby(config.inputCss);
  const outputScopes = [];

  const outputs = [];

  const stripData = { htmlDeps: [], reactDeps: [] };

  await readAndWriteCss();

  const allScopeClasses = outputScopes.map(({ scopeSelector }) =>
    // e.g. ".recipe-page-234ffb" → "recipe-page-234ffb"
    scopeSelector.slice(1)
  );

  await readAndWriteHtml();
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
          !['*', '>', '+', '~', ',', '|'].some((ch) => seg.startsWith(ch))
        ) {
          seg = '.' + seg;
        }
      }

      segs[index] = seg;
    }
    return segs.join(' ');
  }

  async function readAndWriteCss() {
    const scopes = [];

    for (const teamPath of cssFiles) {
      const css = await fs.promises.readFile(teamPath, 'utf-8');
      const root = postcss.parse(css, { from: teamPath });

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
            if (rule.type !== 'rule' || rule.selector?.startsWith(sel)) {
              adjacentRules.push(rule);
            } else break;
          }

          if (hash && (!fork || fork === hash)) {
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

    /*
    if (deletedContent?.hashDeleted)
    {
      for (const {hash} of deletedContent.hashDeleted)
      {
        for (const srcPath of srcCssFiles) {
          const content = await fs.promises.readFile(srcPath, 'utf8');
          if (content.includes(`--scope-hash: ${hash}`) || content.includes(`--scope-hash:${hash}`)) {
            deletedFiles.push (srcPath);
            srcCssFiles = srcCssFiles.filter (s => s !== srcPath);
            break;
          }
        }
      }
    }*/

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

      const extracted = [];
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
      const keyframesArr = [];
      adjacentRules.forEach((rule) => {
        let isKeyframes =
          rule.parent?.type === 'atrule' && rule.parent.name === 'keyframes';

        if (isKeyframes) {
          if (keyframesArr.includes(rule.parent)) return;

          if (rule.parent.params.startsWith(`${className}__`)) {
            const spl = rule.parent.params.split('__');
            rule.parent.params = spl[spl.length - 1];

            rule.walkDecls('animation', (decl) => {
              if (decl.value.startsWith(`${className}__`)) {
                const spl = decl.value.split('__');
                decl.value = spl[spl.length - 1];
              }
            });
            rule.walkDecls('animation-name', (decl) => {
              if (decl.value.startsWith(`${scopeSelector}__`)) {
                const spl = decl.value.split('__');
                decl.value = spl[spl.length - 1];
              }
            });
            extracted.push(rule.parent);
          }
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

        if (rule.parent?.type === 'atrule' && rule.parent.name === 'media') {
          if (!extracted.includes(rule)) extracted.push(rule.parent);
          return;
        }

        extracted.push(rule);
      });

      if (extracted.length === 0) continue;

      outputs.push({
        outPath,
        output: extracted.map((e) => e.toString()).join('\n\n'),
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
    for (const htmlPath of htmlFiles) {
      const outPath = path.join(srcRoot, path.relative(syncRepo, htmlPath));

      const html = await fs.promises.readFile(htmlPath, 'utf8');

      let hasClass = false;
      for (const klass of allScopeClasses) {
        const classRegex = getHasClassRegex(klass);

        if (classRegex.test(html)) {
          hasClass = true;
          break;
        }
      }
      if (!hasClass) continue;

      stripData.htmlDeps.push(outPath);

      const dom = await readAndWriteDom(
        parseDocument(html, { recognizeSelfClosing: true })
      );

      outputs.push({
        outPath,
        output: serialize(dom, { encodeEntities: 'utf8' }),
      });
    }
  }

  function unflattenHtmlClass(className, localConfig) {
    if (localConfig.dontFlatten) {
      return className;
    }

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
          (val) => cls === val || cls.startsWith(`${val}__`)
        );
      }
      function processNode(node, currBreak = false) {
        if (!node.attribs?.class) {
          for (const child of node.children || [])
            processNode(child, currBreak);
          return;
        }

        const classes = node.attribs.class
          .trim()
          .split(/\s+/)
          .filter((cls) => !cls.startsWith('$'));

        if (classes.some((val) => isMyKlass(val))) currBreak = false;

        if (!currBreak) {
          if (classes.some((val) => scopePrefixes.includes(val))) {
            if (classes.every((val) => !isMyKlass(val)))
              results.push({ node, excludeAll: true });
            else if (classes.some((val) => !isMyKlass(val)))
              results.push({
                node,
                exclude: classes.filter((cls) => !isMyKlass(cls)),
              });
          } else if (classes.every((val) => !isMyKlass(val))) {
            results.push({ node, allInvalid: true });
            currBreak = true;
          } else if (classes.some((val) => !isMyKlass(val))) {
            results.push({
              node,
              invalid: classes.filter((val) => !isMyKlass(val)),
            });
            currBreak = true;
          }
        }

        for (const child of node.children || []) processNode(child, currBreak);
      }

      processNode(dom);

      return results;
    }

    const notMine = selectOuterUnscopedNodes(dom, outputScopes);

    for (const { node, allInvalid, invalid, exclude, excludeAll } of notMine) {
      if (excludeAll) node.attribs['data-exclude'] = '';
      else if (exclude) node.attribs['data-exclude'] = exclude.join(',');
      else if (allInvalid) node.attribs['data-break'] = '';
      else node.attribs['data-break'] = invalid.join(',');
    }

    for (const [
      i,
      { scopeSelector, baseClass, outPath, klass },
    ] of outputScopes.entries()) {
      const localConfig = resolveConfigFor(outPath, config, config.inputDir);

      let foundExact = false;

      const nodes = cssSelect.selectAll((elem) => {
        if (!elem.attribs || !elem.attribs.class) return false;
        return elem.attribs.class
          .split(/\s+/)
          .some((token) => token.startsWith(klass));
      }, dom);

      nodes.forEach((node) => {
        const classTokens = node.attribs.class.split(/\s+/);

        let updated = false;
        let exactMatch = false;

        const newTokens = classTokens.map((token) => {
          if (token === klass) {
            exactMatch = true;
            updated = true;
            return baseClass;
          } else if (token.startsWith(klass)) {
            updated = true;
            let replaced = token.replace(klass, baseClass);
            if (!localConfig.dontFlatten) {
              replaced = unflattenHtmlClass(replaced, localConfig);
              replaced = getLastClassPiece(replaced);
            }
            return replaced;
          }
          return token;
        });

        if (updated) {
          node.attribs.class = newTokens.join(' ');
        }

        if (exactMatch) {
          node.attribs['data-scope'] = String(i);
          foundExact = true;
        }
      });

      if (foundExact) {
        usedScopes.push({
          name: `auto-scope-${i}`,
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
    for (const file of reactFiles) {
      const code = await fs.promises.readFile(file, 'utf8');

      let hasClass = false;
      for (const klass of allScopeClasses) {
        const classNameRegex = getHasClassNameRegex(klass);
        if (classNameRegex.test(code)) {
          hasClass = true;
          break;
        }
      }

      if (!hasClass) return;

      reactDeps.push(outPath);

      const ast = await getAST(file);
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
        ? await state.jsFormatter(output)
        : await state.tsFormatter(output);
      await fs.promises.writeFile(outPath, out);
      console.log('outp: ', out);
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
      const cssDeps = await readMetaTags([
        ...stripData.htmlDeps,
        ...stripData.reactDeps,
      ]);
      await writeCssAndHtml(
        cssDeps,
        findDomsInCache(stripData.htmlDeps),
        findDomsInCache(stripData.reactDeps)
      );
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

  const teamCssFiles = await globby([`${config.teamRepo}/**/*.css`]);

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
