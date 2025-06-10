import {
  state,
  getRelativePath,
  resolveConfigFor,
  addIdToIdCache,
  getGlobalCssFiles,
  findIdFromCache,
  getFreeId,
  generateCssModuleHash,
  insertLinkIntoHead,
  findHtmlDeps,
  getNumberSuffix,
  replaceLast,
  removeIdFromCache,
} from '../shared.js';
import { writeToAST, replaceLinkStylesheetsWithImports } from './react.js';
import fs from 'fs';
import path from 'path';
import postcss from 'postcss';
import * as cssSelect from 'css-select';
import { default as serialize } from 'dom-serializer';
import { globby } from 'globby';
import * as DomUtils from 'domutils';

async function writeCssAndHtml(cssFiles, htmlDoms, asts) {
  const cssConfigs = {};

  const {
    runtimeMap,
    config,
    scopeHashFileMap,
    scopeHashsMap,
    allCombis,
    mergeCssMap,
    outputCss,
  } = state;

  function removeCombinators(selector) {
    Object.keys(allCombis).forEach(
      (combi) => (selector = selector.replaceAll(` ${combi}`, ''))
    );
    return selector;
  }
  function replaceCombinators(selector, flatten = []) {
    Object.entries(allCombis).forEach(([combi, flat]) => {
      if (flatten.includes(combi))
        selector = selector
          .replaceAll(` ${combi} `, flat)
          .replaceAll(` ${combi}`, flat);
    });
    return selector;
  }
  //const globalCssFiles = config.globalCss ? fg.sync (prefixGlobsWithDir (config.globalCss, inputDir)) : [];

  const { inputDir, outputDir } = config;

  const globalCssFiles = getGlobalCssFiles(cssFiles);

  //cssFiles = cssFiles.filter (file => !globalCssFiles.includes (file));

  const selectors = {};
  // 3. Rewrite CSS files, replacing all classes with hashed names

  const cssFilesObjs = (
    await Promise.all(
      cssFiles.map(async (file) => {
        const obj = {
          fileName: path.basename(file, '.css'),
          file,
          css: await fs.promises.readFile(file, 'utf-8'),
        };
        obj.hasHash = obj.css.includes('--scope-hash:');

        return obj;
      })
    )
  ).sort((a, b) => {
    return (b.hasHash === true) - (a.hasHash === true);
  });

  const filesFound = {};

  for (let { file, fileName, css, hasHash } of cssFilesObjs) {
    const isGlobal = globalCssFiles.includes(file);

    const relativePath = path.relative(inputDir, file);
    let outPath = path.join(outputDir, relativePath);

    if (isGlobal) {
      const content = await fs.promises.readFile(file, 'utf-8');
      if (content.includes('.'))
        console.warn(
          'Classes detected in global CSS. Consider scoping these instead.'
        );

      await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
      await fs.promises.copyFile(file, outPath);
      continue;
    }

    //let css = await fs.promises.readFile(file, 'utf8');

    //const fileName = fileNames[index];

    let localConfig = (cssConfigs[fileName] = resolveConfigFor(
      file,
      config,
      inputDir
    ));

    const { mergeCss } = localConfig;

    let scopeIndex = 1;

    const cachedId = findIdFromCache(fileName, { filePath: file });
    const freeId = getFreeId(fileName);

    if (cachedId && freeId > cachedId.id) scopeIndex = cachedId.id;
    else {
      scopeIndex = freeId;
    }
    //const fullScope = scopes.includes(fileName) ? fileName : null;
    //const folderName = path.basename(path.dirname(file));

    let hash;

    function attachHash(root, scopeName, hash) {
      const selector = `.${scopeName}`;
      let rule = root.nodes.find(
        (node) => node.type === 'rule' && node.selector === selector
      );
      if (!rule) {
        rule = postcss.rule({ selector });
        root.append(rule);
      }
      // remove existing and add new --scope-hash
      rule.walkDecls('--scope-hash', (d) => d.remove());

      const newDecl = postcss.decl({
        prop: '--scope-hash',
        value: hash,
      });

      if (localConfig.teamRepo) {
        newDecl.raws.value = {
          raw: `${hash}; /* Collision-prevention ID */`,
          value: hash, // must match actual value for parsing consistency
        };
      }
      // Append it to the rule
      rule.append(newDecl);
    }

    //if (!scopeHashsMap.hasOwnProperty(fileName))
    //   scopeHashsMap[fileName] = new Set();

    if (localConfig.teamRepo || localConfig.writeRuntimeMap) {
      if (hasHash) {
        hash = 'READ';
      } else {
        hash = generateCssModuleHash(file);

        let result;
        try {
          result = await postcss([
            (root) => {
              attachHash(root, fileName, hash);
            },
          ]).process(css, { from: undefined });
        } catch (err) {
          console.log('Attaching hash to file error');
        }
        css = result.css;
        const out = await state.cssFormatter(result.css);
        await fs.promises.writeFile(file, out);
      }
    } else {
      hash = scopeHashFileMap[file];

      if (!hash) hash = generateCssModuleHash(file);
    }

    let result;
    let hashRead;
    let hashDecl;
    let delayedWrite = false;
    const rulesArr = [];

    result = await postcss([
      async (root) => {
        function findHash() {
          let value;

          root.walkRules((rule) => {
            rule.walkDecls((decl) => {
              if (decl.prop === '--scope-hash') {
                value = decl.value.split(' ')[0].trim();
                hashDecl = decl;
                return false; // stop walkDecls
              }
            });
            if (value) return false; // stop walkRules
          });

          return value;
        }

        function findResolveTag() {
          let value;

          root.walkRules((rule) => {
            rule.walkDecls((decl) => {
              if (decl.prop === '--resolve-collision') {
                decl.remove();
                value = true;
                return false; // stop walkDecls
              }
            });
            if (value) return false; // stop walkRules
          });

          return value;
        }

        let suffixOverride = false;
        let resolveTag;
        if (hash === 'READ') {
          hashRead = findHash();
          const idWithHash = findIdFromCache(fileName, { hash: hashRead });

          hash = hashRead;
          resolveTag = findResolveTag();

          if (idWithHash) {
            if (!resolveTag) {
              scopeIndex = idWithHash.id;
              suffixOverride = idWithHash.suffix;
            }
          }

          if (resolveTag) {
            const next = hashDecl.next();

            // Check if next node is a comment and on the same line
            if (
              next &&
              next.type === 'comment' &&
              next.source.start.line === hashDecl.source.end.line
            ) {
              next.remove();
            }

            hashDecl.remove();

            hash = generateCssModuleHash(file, 1);

            attachHash(root, fileName, hash);
            const out = await state.cssFormatter(root.toString());
            if (state.config.devMode) delayedWrite = out;
            else await fs.promises.writeFile(file, out, 'utf-8');
          }
        }

        addIdToIdCache(fileName, { filePath: file, id: scopeIndex });

        //scopeHashsMap[fileName].add(hash);
        scopeHashsMap.add(hash);

        scopeHashFileMap[file] = hash;

        let hashApply = localConfig.useNumbers ? scopeIndex : hash;

        if (localConfig.dontHashFirst && scopeIndex <= 1) hashApply = '';

        if (suffixOverride !== false) hashApply = suffixOverride;

        const dontHash = !hashApply;

        const selectorsObj = {
          selectors: [],
          scopeName: fileName,
          hashedName: dontHash ? fileName : `${fileName}-${hashApply}`,
        };

        if (resolveTag) console.log(`Resolved to ${selectorsObj.hashedName}`);

        selectors[file] = selectorsObj;

        if (localConfig.writeRuntimeMap) {
          runtimeMap[hash] = { ...selectorsObj };
        }

        root.walkRules((rule) => {
          if (
            rule.parent?.type === 'atrule' &&
            rule.parent.name === 'keyframes'
          ) {
            if (rulesArr.includes(rule.parent)) return;

            const atRule = rule.parent;
            const oldName = atRule.params;

            const newName = `${selectorsObj.hashedName}__${oldName}`;
            atRule.params = newName;

            // Then update all usages of this animation name in declarations:
            root.walkDecls((decl) => {
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
            });

            rulesArr.push(atRule);
            return;
          }

          function processSelector(rule, selector) {
            if (
              selector.includes(':root') ||
              selector.startsWith('body') ||
              selector.startsWith('html')
            ) {
              rule.selector.push(selector);
              return;
            }

            if (!selector.startsWith(`.${fileName}`))
              selector = `.${fileName} ${selector}`;

            function flatten(selector, flattenPseudo = true) {
              let flat = replaceCombinators(
                selector,
                localConfig.flattenCombis
              );

              let chain = splitSelectorIntoSegments(flat);

              if (chain.length <= 1)
                return replaceDoubleUnderscoreInString(
                  replaceDotsExceptFirst(
                    flat.replace(`.${fileName}`, `.${selectorsObj.hashedName}`)
                  )
                );

              chain = chain.map((seg) => replaceDotsExceptFirst(seg));

              let flatChain = replaceDoubleUnderscoreInArray(
                chain.map((seg, index) => {
                  if (!state.allCombisKeys.includes(seg))
                    seg =
                      index === 0
                        ? seg.replace(
                            `.${fileName}`,
                            `.${selectorsObj.hashedName}`
                          )
                        : `.${selectorsObj.hashedName}__${seg}`;
                  return stripSpaces(
                    index === 0 ? seg : replaceDotsExceptFirst(seg)
                  );
                })
              );

              chain = chain.map((seg) => removeCombinators(seg));
              return {
                flat: flatChain.join(' '),
                chain,
                flatChain: flatChain.map((seg) =>
                  stripPseudoSelectors(seg.replaceAll('.', ''))
                ),
              };
            }

            const selectorObj = { raw: selector };
            let flat;

            if (!localConfig.dontFlatten) {
              let fullFlattened = flatten(selector);
              if (typeof fullFlattened === 'object') {
                flat = fullFlattened.flat;
                selectorObj.flat = fullFlattened;
                delete fullFlattened.flat;
              } else {
                flat = fullFlattened;
                selectorObj.flat = removeCombinators(
                  stripPseudoSelectors(fullFlattened)
                );
              }
            } else {
              flat = selector.replaceAll(
                `.${fileName}`,
                `.${selectorsObj.hashedName}`
              );
            }

            selectorsObj.selectors.push(selectorObj);

            rule.selector.push(flat);
          }

          const selector = rule.selector;
          rule.selector = [];
          splitSelectors(selector).forEach((s) => processSelector(rule, s));

          rule.selector = rule.selector.join(', ');

          if (rule.parent?.type === 'atrule' && rule.parent.name === 'media') {
            if (!rulesArr.includes(rule.parent)) rulesArr.push(rule.parent);
            return;
          }

          rulesArr.push(rule);
        });

        /*
          if (scanIDs)
          {
            if(!localConfig.dontHashFirst || scopeIndex > 1)
            {
              const metaComment = postcss.comment ({
                text: `@exclude ${selectorsObj.hashedName}`
              })
              allRules[0].parent.insertBefore (allRules[0], metaComment);
            }
          }*/
      },
    ]).process(css, { from: undefined });

    let fileFound;

    if (hashRead) {
      const mapObj = state.teamRepoHashMap[fileName + '/' + hashRead];

      if (mapObj) {
        const { cssRoot, filePath } = mapObj;

        delete state.teamRepoHashMap[fileName + '/' + hashRead];
        state.teamRepoHashMap[fileName + '/' + hash] = mapObj;

        const root = cssRoot;
        fileFound = {
          filePath: path.join(state.config.outputDir, filePath),
          cssRoot: root,
        };

        filesFound[file] = fileFound.filePath;

        let targetClass = null;
        let insertIndex = null;
        let targetRule = null;
        // Step 1: Find the rule with the matching --scope-hash
        root.walkRules((rule) => {
          for (const decl of rule.nodes || []) {
            if (
              decl.prop === '--scope-hash' &&
              decl.value.split(' ')[0].trim() === hashRead
            ) {
              targetClass = rule.selector.split(',')[0].split(' ')[0];
              insertIndex = root.index(rule); // ✅ Save the index before removal
              targetRule = rule;
              return false; // Stop searching
            }
          }
        });

        // Step 2: Collect rules to remove
        const rulesToRemove = [];
        for (let i = insertIndex - 1; i >= 0; i--) {
          const rule = root.nodes[i];
          if (rule.selector?.startsWith(targetClass)) rulesToRemove.push(rule);
          else break;
        }

        rulesToRemove.push(targetRule);

        for (let i = insertIndex + 1; i < root.nodes.length; i++) {
          const rule = root.nodes[i];
          if (rule.type === 'rule') {
            if (rule.selector?.startsWith(targetClass))
              rulesToRemove.push(rule);
            else break;
          } else if (
            rule.parent?.type === 'atrule' &&
            rule.parent.name === 'media'
          )
            rulesToRemove.push(rule);
        }

        root.walkAtRules('keyframes', (atRule) => {
          if (
            atRule.params.startsWith(`${targetClass.replaceAll('.', '')}__`)
          ) {
            rulesToRemove.push(atRule);
          }
        });

        // Step 3: Insert new rules before removing the old ones
        const insertNodes = rulesArr;

        // Insert nodes at original index
        if (insertIndex !== null && insertNodes.length > 0) {
          insertNodes.forEach((node, i) => {
            root.insertAfter(insertIndex + i - 1, node);
          });
        } else {
          insertNodes.forEach((node) => root.append(node));
        }

        if (state.config.useCssFormatterInjecting === false) {
          insertNodes.forEach((node) => {
            node.raws.before = '\n\n';
          });
          insertNodes[0].raws.before = '\n\n\n\n';
        }
        // Step 4: Remove collected rules
        rulesToRemove.forEach((rule) => rule.remove());

        // Step 5: Clean up empty media queries
        root.walkAtRules('media', (atRule) => {
          if (atRule.nodes.length <= 0) atRule.remove();
        });
      }
    }

    if (fileFound) outPath = fileFound?.filePath;

    if (mergeCss) {
      mergeCssMap[file] = result.css;
    } else {
      await fs.promises.mkdir(path.dirname(outPath), { recursive: true });

      const raw = fileFound?.cssRoot.toString() || result.css;

      let out;
      if (!fileFound || state.config.useCssFormatterInjecting !== false)
        out = await state.cssFormatter(raw);
      else out = raw;

      await fs.promises.writeFile(outPath, out);
    }

    if (delayedWrite) await fs.promises.writeFile(file, delayedWrite, 'utf-8');
  }

  let mergedOutpath;
  if (config.mergeCss) {
    let mergedCss = Object.values(mergeCssMap).join('\n');

    mergedOutpath = path.join(
      outputDir ? outputDir + '/css' : outputCss,
      `${path.basename(config.mergeCss, '.css')}.css`
    );
    await fs.promises.mkdir(path.dirname(mergedOutpath), { recursive: true });
    mergedCss = await state.cssFormatter(mergedCss);
    await fs.promises.writeFile(mergedOutpath, mergedCss);
  }

  function processNodes(
    nodes,
    currentScope = {},
    inForm = false,
    ignoreScope = false
  ) {
    nodes.forEach((node) => {
      delete node.attribs?.keepSub;

      if (node.name === 'form') inForm = true;

      let scope = currentScope;
      let prevScope = scope;
      let isScope;
      if (node.attribs?.scope) {
        scope = node.attribs.scope;
        isScope = true;
        ignoreScope = false;
        delete node.attribs.scope;
      }
      let ignoreScopeData;
      if (node.attribs?.hasOwnProperty('data-break')) {
        ignoreScopeData = node.attribs['data-break']
          ? node.attribs['data-break'].split(',')
          : '';
        delete node.attribs['data-break'];
        ignoreScope = true;
      }

      let excludeData;
      let exclude = false;
      if (node.attribs?.hasOwnProperty('data-exclude')) {
        excludeData = node.attribs['data-exclude']
          ? node.attribs['data-exclude'].split(',')
          : '';
        delete node.attribs['data-exclude'];
        exclude = true;
      }

      if (scope.hasOwnProperty('name')) {
        if (inForm) {
          let formProp = node.attribs?.for
            ? 'htmlFor'
            : node.attribs?.id
            ? 'id'
            : '';
          if (formProp) {
            if (!formProp.includes('__'))
              node.attribs[
                formProp
              ] = `${scope.hashedName}__${node.attribs.htmlFor}`;
            else
              node.attribs[formProp] = node.attribs.htmlFor.replace(
                `${scope.name}__`,
                `${scope.hashedName}__`
              );
          }
        }

        if (node.attribs?.class) {
          const classes = node.attribs.class.split(' ');
          let flatClasses = node.attribs.flatClasses || [];

          const contextSymbol = scope.config?.contextSymbol;
          for (const cls of classes) {
            if (cls.includes('$')) {
              flatClasses.push(cls);
            } else if (
              exclude &&
              (!excludeData ||
                excludeData.length <= 0 ||
                excludeData.includes(cls))
            ) {
              const flatIndex = flatClasses.findIndex((flatCls) =>
                flatCls.endsWith(`__${cls}`)
              );
              if (flatIndex !== -1) flatClasses[flatIndex] = cls;
              else flatClasses.push(cls);
            } else if (
              ignoreScope &&
              (!ignoreScopeData ||
                ignoreScopeData.length <= 0 ||
                ignoreScopeData.includes(cls))
            ) {
              const flatIndex = flatClasses.findIndex((flatCls) =>
                flatCls.endsWith(`__${cls}`)
              );
              if (flatIndex !== -1) flatClasses[flatIndex] = cls;
              else flatClasses.unshift(cls);
            } else if (cls.includes(contextSymbol)) {
              if (scope.config.dontFlatten) flatClasses.push(cls);
              else
                flatClasses.push(
                  `${scope.hashedName}__${cls.split(contextSymbol)[0]}`
                );
            }
          }

          if (scope.config.dontFlatten) {
            if (!isScope) {
              flatClasses.push(
                ...classes
                  .filter((cls) => !flatClasses.includes(cls))
                  .map((cls) =>
                    cls.startsWith(`${scope.name}__`)
                      ? cls.replace(`${scope.name}__`, `${scope.hashedName}__`)
                      : cls
                  )
              );
            } else {
              flatClasses.push(
                ...classes
                  .filter((cls) => cls !== scope.name)
                  .map((cls) =>
                    prevScope.name
                      ? cls.replace(
                          `${prevScope.name}__`,
                          `${prevScope.hashedName}__`
                        )
                      : cls
                  )
              );
            }
          } /*else {
              const stripUnusedClasses =
                !scope.config?.hasOwnProperty('stripClasses') ||
                scope.config?.stripClasses;

              if (!stripUnusedClasses && flatClasses.length === 0 && classes.length > 0 && !isScope)
                flatClasses = [`${scope.hashedName}__${classes[0]}`];
             
            }*/

          node.attribs.flatClasses = flatClasses;
        }
        let newClass;
        if (node.attribs)
          newClass = node.attribs.flatClasses?.join(' ') || undefined;

        if (newClass != node.attribs?.class) node.attribs.class = newClass;

        delete node.attribs?.flatClasses;

        if (node.attribs?.class)
          node.attribs.class = [
            ...new Set(
              node.attribs.class
                .split(' ')
                .map((cls) => cls.replaceAll('.', ' '))
            ),
          ].join(' ');

        if (node.attribs && !node.attribs.class) delete node.attribs.class;
      } else {
        delete node.attribs?.flatClasses;
      }
      if (node.children)
        processNodes(node.children, scope || currentScope, inForm, ignoreScope);
    });
  }

  const selectorEntries = Object.entries(selectors);

  function getRelativePathForLink(inputPath, rootFilePath) {
    const rootDir = path.dirname(path.resolve(rootFilePath)); // directory of root file
    const absoluteInputPath = path.resolve(inputPath); // absolute path of input
    let relative = path.relative(rootDir, absoluteInputPath); // path from root to input

    // If the relative path doesn’t start with "../", prefix with "./"
    if (!relative.startsWith('.') && relative !== '') {
      relative = './' + relative;
    }
    return relative;
  }

  if (asts?.length > 0) {
    htmlDoms = [];
    for (const ast of asts) htmlDoms.push(...ast.doms);
  }
  htmlDoms.forEach(async (dom, index) => {
    dom = structuredClone(dom);

    const htmlFilePath = dom.filePath;
    const relativePath = getRelativePath(htmlFilePath);
    const outPath = path.join(outputDir, relativePath);
    dom.outPath = outPath;

    if (mergedOutpath) insertLinkIntoHead(dom, `/` + mergedOutpath);

    const metaTags = state.metaTagMap[dom.filePath];

    metaTags.forEach((tag) => {
      let scopeId = tag.scopeId;

      const otherMetaTags = metaTags.filter((t) => t != tag);

      tag.content = tag.content.replace(`${inputDir}/`, `${outputDir}/`);

      selectorEntries.forEach(([filePath, valueObj]) => {
        if (tag.relativePath === filePath) {
          const foundPath = filesFound[filePath];
          if (!state.config.mergeCss)
            insertLinkIntoHead(
              dom,
              foundPath
                ? getRelativePathForLink(foundPath, outPath)
                : tag.content.replace(
                    `${state.config.inputDir}/`,
                    `${state.config.outputDir}/`
                  )
            );
          const scopeNodes = cssSelect.selectAll(
            `.${valueObj.scopeName}`,
            dom.children
          );
          const localConfig = cssConfigs.hasOwnProperty(valueObj.scopeName)
            ? cssConfigs[valueObj.scopeName]
            : config;

          for (const scopeNode of scopeNodes) {
            const dataScope = scopeNode.attribs['data-scope'];

            if (dataScope === undefined || dataScope === scopeId) {
              delete scopeNode.attribs['data-scope'];

              scopeNode.attribs.scope = {
                name: valueObj.scopeName,
                hashedName: valueObj.hashedName,
                config: localConfig,
              };

              /*
                if (localConfig.dontFlatten) {
                  for (const {raw} of valueObj.selectors) {
                    for (const otherMetaTag of otherMetaTags) {
  
                      if (!raw.includes (`.${otherMetaTag.scopeName}`))
                        continue;
  
                    const matches = cssSelect.selectAll(
                      stripPseudoSelectors (raw),
                      scopeNode.children
                    )
                    for (const match of matches) {
                      function processNode(node) {
                        
                          const classes = node.attribs?.class?.split(' ') || [];
                         
                          const indexOf = classes.indexOf(otherMetaTag.scopeName);
                          if(indexOf !== -1)
                          {
                            node.attribs.keepSub = true;
                            return;
                          }
                        if (node.parent)
                          processNode(node.parent);
  
                      }
  
                        processNode(match);
                    }
                    }
                  }
  
                }*/

              const flatClasses = (scopeNode.attribs.flatClasses =
                scopeNode.attribs.flatClasses || []);

              flatClasses.unshift(`${valueObj.hashedName}`);

              if (scopeNode.attribs.keepSub)
                scopeNode.attribs.flatClasses.push(valueObj.scopeName);

              if (localConfig.dontFlatten) continue;

              // 1) build a list of nested scope selectors under this scopeNode
              const nestedSelectors = otherMetaTags
                .map((t) => `.${t.scopeName}`)
                .join(', ');
              const nestedScopeNodes = nestedSelectors
                ? cssSelect
                    .selectAll(nestedSelectors, [scopeNode])
                    .filter((subNode) =>
                      otherMetaTags.findIndex(
                        (tag) =>
                          subNode.classList?.contains(tag.scopeName) &&
                          (subNode.attribs['data-scope'] === undefined ||
                            tag.scopeId === subNode.attribs['data-scope']) !==
                            -1
                      )
                    )
                : [];

              // helper to test ancestry
              const isDescendantOf = (node, parents) => {
                while (node.parent) {
                  if (parents.includes(node.parent)) return true;
                  node = node.parent;
                }
                return false;
              };

              for (const { raw, flat } of valueObj.selectors) {
                const matches = cssSelect
                  .selectAll(stripPseudoSelectors(raw), [scopeNode])
                  .filter((node) => !isDescendantOf(node, nestedScopeNodes));

                console.log(raw, flat);

                matches.forEach((match) => {
                  function processPseudoNode(node, i = flat.chain.length - 1) {
                    while (state.allCombisKeys.includes(flat.chain[i])) i--;

                    const segment = flat.chain[i].split(':')[0];
                    const segmentParts = segment.split('__');
                    const finalPart = segmentParts[segmentParts.length - 1];

                    const flatSeg = flat.flatChain[i];
                    console.log(
                      node.name,
                      node.attribs?.class || '',
                      finalPart
                    );
                    if (cssSelect.is(node, finalPart)) {
                      console.log('yes');
                      if (!node.attribs.flatClasses)
                        node.attribs.flatClasses = [];

                      node.attribs.flatClasses.push(flatSeg);

                      i--;
                    }

                    if (i < 0) return;

                    if (node.parent) processPseudoNode(node.parent, i);
                  }
                  if (typeof flat === 'object') processPseudoNode(match);
                  else {
                    function removeFirstDot(str) {
                      return str.startsWith('.') ? str.slice(1) : str;
                    }

                    function getAfterDot(str) {
                      return str.includes('.') ? str.split('.')[1] : str;
                    }

                    if (!match.attribs.flatClasses)
                      match.attribs.flatClasses = [];
                    match.attribs.flatClasses.push(
                      getAfterDot(removeFirstDot(flat))
                    );
                  }
                });
              }
            }
          }
        }
      });
    });

    processNodes([dom], '');

    if (!asts || asts.length <= 0) {
      await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
      const raw = serialize(dom, { encodeEntities: 'utf8' });
      const out = await state.htmlFormatter(raw);
      await fs.promises.writeFile(outPath, out);
    }
    /*
    for (const [index, tagContent] of relativePaths.entries())
    {
      const tag = metaTags[index];
      tag.relativePath = tagContent.relativePath;
      tag.scopeId = tagContent.scopeId;
      tag.scopeName = tagContent.scopeName;
    }
  */
    /*
      function getAllScriptSrcs(node, result = []) {
        node.forEach((child) => {
          if (child.name === 'script' && child.attribs?.src) {
            result.push(child.attribs.src);
          }
          if (child.children) getAllScriptSrcs(child.children, result);
        });
        return result;
      }
  
      async function copyReferencedScripts(scriptPaths, htmlFilePath, outputDir) {
        for (const src of scriptPaths) {
          // Handle absolute and relative paths
          let inputPath;
          if (src.startsWith('/')) {
            const projectRoot = path.resolve(__dirname, '..');
            inputPath = path.join(projectRoot, src);
          } else {
            inputPath = path.resolve(path.dirname(htmlFilePath), src);
          }
          // Compute relative path
          const relativePath = getRelativePath(inputPath);
  
          const outPath = path.join(outputDir, relativePath);
  
          await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
          await fs.promises.copyFile(inputPath, outPath);
        }
      }*/
    // if (config.copyJs)
    //copyFiles (inputDir, outputDir);
  });

  if (asts?.length > 0) {
    for (const ast of asts) {
      replaceLinkStylesheetsWithImports(ast);
      const raw = await writeToAST(ast);
      const out = ast.filePath.endsWith('.jsx')
        ? await state.jsFormatter(raw)
        : await state.tsFormatter(raw);
      const relativePath = getRelativePath(ast.filePath);
      const outPath = path.join(outputDir, relativePath);
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, out, 'utf8');
    }
  }

  const runtimeMapKeys = Object.keys(runtimeMap);

  if (runtimeMapKeys.length > 0) {
    /*
      Object.keys(runtimeMap).forEach((key) => {
        const relativePath = getRelativePath(key);
        const outPath = path.join(outputDir, relativePath);
        if (key === outPath) return;
        runtimeMap[outPath] = runtimeMap[key];
        delete runtimeMap[key];
      });*/
    const outPath =
      state.config.writeRuntimeMap === true
        ? 'auto-scope-runtime-map.json'
        : state.config.writeRuntimeMap;

    await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
    await fs.promises.writeFile(outPath, JSON.stringify(runtimeMap, null, 2));
  }
}

/**
 * Split a selector into segments at pseudos or combinators,
 * preserving those tokens at the end of their segment.
 *
 * @param {string} sel
 * @returns {string[]}
 */
function splitSelectorIntoSegments(sel) {
  // 1) Tokenize:
  //    - ::pseudo or :pseudo(...) or :pseudo
  //    - combinators > + ~
  //    - anything else (\S+)
  const tokenPattern = /::?[^\s>+~]+(?:\([^\)]*\))?|[>+~]|\S+/g;
  const tokens = sel.match(tokenPattern) || [];

  const segments = [];
  let curr = '';

  for (const tok of tokens) {
    if (tok === '>' || tok === '+' || tok === '~') {
      // combinator: append and flush
      curr = curr ? `${curr} ${tok}` : tok;
      segments.push(curr.trim());
      curr = '';
    } else if (tok.includes(':')) {
      // pseudo-selector: append and flush
      curr = curr ? `${curr} ${tok}` : tok;
      segments.push(curr.trim());
      curr = '';
    } else {
      // plain token: accumulate
      curr = curr ? `${curr} ${tok}` : tok;
    }
  }

  // flush any trailing chunk
  if (curr) segments.push(curr.trim());
  return segments;
}

function replaceDoubleUnderscoreInString(str) {
  const parts = str.split('__');
  if (parts.length <= 2) return str;
  return parts.slice(0, 2).join('__') + '-' + parts.slice(2).join('-');
}

function replaceDoubleUnderscoreInArray(arr) {
  return arr.map(replaceDoubleUnderscoreInString);
}

function replaceDotsExceptFirst(input) {
  return stripSpaces(input).replaceAll('_.', '_');
}

function stripSpaces(selector) {
  return selector.replace(/(?<![>+~*~|])\s+(?![>+~*~|])/g, '__');
}

function stripPseudoSelectors(selector) {
  return selector.replace(/::?[a-zA-Z0-9\-\_()]+/g, '');
}

function splitSelectors(selectorString) {
  return selectorString
    .split(/\s*,\s*/) // split by comma with optional spaces around it
    .map((sel) => sel.trim()) // trim whitespace just in case
    .filter(Boolean); // remove empty strings if any
}

function removeLinkFromHead(dom, href) {
  const node = DomUtils.findOne(
    (el) => el.name === 'link' && el.attribs.href === href,
    dom.children,
    true
  );

  if (node)
    node.parent.children = node.parent.children.filter((c) => c !== node);
}

async function readGlobalCss() {
  const globalCssFiles = await globby(state.globalCss);
  const cssFiles = (await globby(state.config.inputCss)).filter(
    (file) => !globalCssFiles.includes(file)
  );
  const scopesCovered = new Set();

  for (const [scopeName, val] of Object.entries(state.globalCssCache)) {
    if (state.scopeHashsMap[scopeName])
      state.scopeHashsMap[scopeName] = new Set(
        Array.from(state.scopeHashsMap[scopeName]).filter(
          (h) => !val.hashes.includes(h)
        )
      );
    for (const number of val.numbers) removeIdFromCache(scopeName, number);

    delete delete state.globalCssCache[scopeName];
  }
  for (const file of globalCssFiles) {
    const globalCss = await fs.promises.readFile(file, 'utf8');

    await postcss([
      (root) => {
        root.walkRules((rule) => {
          const selectors = rule.selector.split(',');

          selectors.forEach((selector) => {
            selector = selector.split(' ')[0].replaceAll('.', '').trim();
            /*
              const hash = getHashFromSelector (selector);
             
              if (hash)
              {
                const scopeName =  selector.replace (`-${hash}`, '');
                if(!state.scopeHashsMap[scopeName])
                  state.scopeHashsMap[scopeName] = [];

                state.scopeHashsMap[scopeName].push (hash);

                if (!state.globalCssCache[scopeName])
                  state.globalCssCache[scopeName] = {hashes: [], numbers: [] }

                state.globalCssCache[scopeName].hashes.push (hash);
              }*/

            const id = getNumberSuffix(selector) || 1;
            let scopeName;

            if (id) scopeName = replaceLast(selector, `-${id}`, '');
            else scopeName = selector;

            addIdToIdCache(scopeName, { id, global: true });
            scopesCovered.add(scopeName);

            if (!state.globalCssCache[scopeName])
              state.globalCssCache[scopeName] = { hashes: [], numbers: [] };

            state.globalCssCache[scopeName].numbers.push(id);
          });
        });
      },
    ]).process(globalCss, { from: undefined });
  }

  const cssDeps = cssFiles.filter((file) =>
    scopesCovered.has(path.basename(file, '.css'))
  );

  await writeCssAndHtml(
    cssDeps,
    findHtmlDeps(cssDeps),
    findHtmlDeps(cssDeps, true)
  );
}

export { writeCssAndHtml, readGlobalCss };
