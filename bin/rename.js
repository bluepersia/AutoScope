#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import globby from 'globby';
import { parseDocument } from 'htmlparser2';
import domSerializer from 'dom-serializer';
import {initInputHtml, initInputReact} from "auto-scope/build";
import {getAST, writeToAST} from "../main/react.js";
import {getHasClassRegex, getHasClassNameRegex} from "../shared.cjs";
import loadConfig from './loadConfig.js';

const config = await loadConfig ();
await initInputHtml (config);
await initInputReact (config);
 

  main().catch(err => {
    console.error(err);
    process.exit(1);
  });


function parseArgs() {
  const args = process.argv.slice(2);
  let filePath, newName;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--filePath' && args[i + 1]) {
      filePath = args[i + 1];
    }
    if (args[i] === '--to' && args[i + 1]) {
      newName = args[i + 1];
    }
  }
  if (!filePath || !newName) {
    console.error('Usage: node renameScope.js --filePath path/to/file.css --to newName');
    process.exit(1);
  }
  return { filePath, newName };
}

// CSS renaming logic
async function renameCss(filePath, scopeName, newName) {
  const cssRaw = await fs.readFile(filePath, 'utf8');

  const root = postcss.parse(cssRaw);

  const processor = selectorParser(selectors => {
    selectors.walkClasses(classNode => {
      const val = classNode.value;
      if (val === scopeName) {
        classNode.value = newName;
      } else if (val.startsWith(scopeName + '__')) {
        classNode.value = newName + val.slice(scopeName.length);
      }
    });
  });

  root.walkRules(rule => {
    try {
      rule.selector = processor.processSync(rule.selector);
      rule.walkDecls((decl) => {
        if (decl.prop === '--scope-hash') {
          const next = decl.next();

            // Check if next node is a comment and on the same line
            if (next && next.type === 'comment' && next.source.start.line === decl.source.end.line) {
                  next.remove();
                }

                decl.remove ();
        }});
    } catch (err) {
      // Just skip any selector that can't be parsed
      console.warn(`Skipping selector "${rule.selector}" due to parsing error: ${err.message}`);
    }
  });

  await fs.writeFile(filePath.replace (path.basename (filePath), `newName.css`), root.toString(), 'utf8');
  await fs.rm (filePath);
}

function processDOM (scopeName, newName, dom)
{
  function renameClassesInNode(node) {
    if (node.attribs && node.attribs.class) {
      const classes = node.attribs.class.split(/\s+/);
      const newClasses = classes.map(cls => {
        if (cls === scopeName) return newName;
        if (cls.startsWith(scopeName + '__')) return newName + cls.slice(scopeName.length);
        return cls;
      });
      node.attribs.class = newClasses.join(' ');
    }
    if (node.children && node.children.length > 0) {
      node.children.forEach(renameClassesInNode);
    }
  }

  renameClassesInNode(dom);
}

// HTML renaming logic
async function renameHtmlFiles(scopeName, newName, inputGlobs) {
  const paths = await globby(inputGlobs);

  for (const htmlPath of paths) {
    let htmlRaw = await fs.readFile(htmlPath, 'utf8');

    // Quick check to skip if no mention of scopeName anywhere
    if (!getHasClassRegex (scopeName).test (htmlRaw)) continue;

    const dom = parseDocument(htmlRaw);

    processDOM (scopeName, newName, dom);

    const serialized = domSerializer(dom, { decodeEntities: true });

    await fs.writeFile(htmlPath, serialized, 'utf8');
  }
}

async function renameReactFiles (scopeName, newName, inputGlobs)
{
  const paths = await globby(inputGlobs);

  for (const reactPath of paths)
  {
    const jsxRaw = fs.readFile (reactPath, 'utf-8');

    if (!getHasClassNameRegex (scopeName).test (jsxRaw)) continue;

    const ast = await getAST (reactPath);

    for(const dom of ast.doms)
      processDOM (scopeName, newName, dom);

    const out = await writeToAST (ast);

    await fs.writeFile(reactPath, out, 'utf8');
  }
}
async function main() {
  const { filePath, newName } = parseArgs();

  // derive scopeName from filename without extension
  const scopeName = path.basename(filePath, '.css');

  await renameCss(filePath, scopeName, newName);

  await renameHtmlFiles(scopeName, newName, config.inputHtml);
  
  await renameReactFiles (scopeName, newName, config.inputReact);

  console.log(`Renamed scope "${scopeName}" to "${newName}" in CSS and HTML files.`);
}

