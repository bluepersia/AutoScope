import fs from 'fs';
import path from 'path';
let parser;
let generate;
let traverse;
let t;
import { parseDocument } from 'htmlparser2';
import {default as serialize} from 'dom-serializer';

try {
  const require = createRequire(pathToFileURL(path.join(process.cwd(), 'index.js')).href);
  parser = require('@babel/parser');
  generate = require('@babel/generator').default;
  traverse = require(('@babel/traverse')).default;
  t = require('@babel/types');
} catch (err) {
  // Handle module loading errors
}

// Attribute mappings
const jsxToHtmlAttr = { className: 'class', htmlFor: 'for' };
const htmlToJsxAttr = Object.fromEntries(
  Object.entries(jsxToHtmlAttr).map(([k, v]) => [v, k])
);

/**
 * Convert a JSX AST node into htmlparser2 DOM.
 * Attaches original AST node and placeholder map to the DOM.
 */
function loadComponentAsDOM(jsxNode) {
  let code = generate(jsxNode).code;

  // Replace JSX-specific attributes with HTML equivalents
  code = code.replace(/\b(className|htmlFor)=/g, (_, p) => `${jsxToHtmlAttr[p]}=`);

  const placeholders = new Map();
  let counter = 0;

  // Replace dynamic props with placeholders
  code = code.replace(/(\w+)=\{([^}]+)\}/g, (_, attr, expr) => {
    const ph = `__ph_${counter++}__`;
    placeholders.set(ph, `{${expr}}`);
    return `${attr}="${ph}"`;
  });

  // Replace JSX components with placeholders
  code = code.replace(/<([A-Z][^\s/>]*)\b([^>]*)\/?>(?:<\/\1>)?/g, match => {
    const ph = `__comp_${counter++}__`;
    placeholders.set(ph, match);
    return `<${ph}/>`;
  });

  const dom = parseDocument(code, {
    xmlMode: true,
    recognizeSelfClosing: true,
    lowerCaseTags: false
  });

  dom.placeholders = placeholders;
  return dom;
}

/**
 * Convert an htmlparser2 DOM back to a JSX AST node.
 * Restores attributes and components, cleans metadata.
 */
function writeDOMToJSX(dom, ext) {
  let html = serialize(dom, { xmlMode: true });

  // Restore placeholders with original expressions
  for (const [ph, expr] of dom.placeholders.entries()) {
    const regex = new RegExp(ph, 'g');
    html = html.replace(regex, expr);
  }

  // Replace HTML attributes with JSX equivalents
  html = html.replace(/\b(class|for)=/g, (_, p) => `${htmlToJsxAttr[p]}=`);

  return parser.parseExpression(html, {
    plugins: ['jsx', ext === '.tsx' ? 'typescript' : null].filter(Boolean)
  });
}

/**
 * Remove `const scope = [...]` from AST, return its values.
 */
function extractAndRemoveScope(ast) {
  let scopeArray = null;
  traverse(ast, {
    VariableDeclaration(path) {
      if (path.node.kind === 'const') {
        path.node.declarations.forEach((decl, i) => {
          if (t.isIdentifier(decl.id, { name: 'autoScope' }) && t.isArrayExpression(decl.init)) {
            scopeArray = decl.init.elements.map(e => t.isLiteral(e) ? e.value : generate(e).code);
            path.node.declarations.splice(i, 1);
          }
        });
        if (!path.node.declarations.length) path.remove();
      }
    }
  });
  if (scopeArray === null) throw new Error('`const scope` declaration not found');
  return scopeArray;
}

/**
 * Main transform. Splits AST processing into two scopes:
 * 1) Collect all JSX/TSX nodes into DOMs
 * 2) After manipulation, convert DOMs back to JSX AST
 */
async function getAST(inputPath) {
  const ext = path.extname(inputPath).toLowerCase();
  if (!['.jsx', '.tsx'].includes(ext)) throw new Error('Input must be .jsx or .tsx');

  const source = await fs.promises.readFile(inputPath, 'utf-8');
  const ast = parser.parse(source, {
    sourceType: 'module',
    plugins: ['jsx', ext === '.tsx' ? 'typescript' : null].filter(Boolean)
  });
  ast.filePath = inputPath;

  // --- Scope 1: JSX → DOM ---
  const doms = ast.doms = [];
  ast.scopeArray = extractAndRemoveScope(ast);
  traverse(ast, {
    JSXElement(path) {
      doms.push(loadComponentAsDOM(path.node));
    },
    JSXFragment(path) {
      doms.push(loadComponentAsDOM(path.node));
    }
  });

  return ast;
}

async function writeToAST(ast) {
  // --- Scope 2: DOM → JSX AST ---
  const ext = path.extname(ast.filePath).toLowerCase();
  let idx = 0;
  traverse(ast, {
    JSXElement(path) {
      const newNode = writeDOMToJSX(ast.doms[idx++], ext);
      path.replaceWith(newNode);
    },
    JSXFragment(path) {
      const newNode = writeDOMToJSX(ast.doms[idx++], ext);
      path.replaceWith(newNode);
    }
  });

  const { code } = generate(ast, { jsescOption: { minimal: true } });
  return code;
}




function replaceLinkStylesheetsWithImports(ast) {
  if (!ast.doms || !Array.isArray(ast.doms)) return

  for (const domAst of ast.doms) {
    // Collect hrefs from <link rel="stylesheet" href="..."/> inside <head>
    const stylesheetHrefs = []

    traverse(domAst, {
      JSXElement(path) {
        const opening = path.node.openingElement

        // Find <head> element
        if (
          t.isJSXIdentifier(opening.name, { name: 'head' })
        ) {
          // Within <head>, look for <link> children with rel="stylesheet"
          path.traverse({
            JSXElement(innerPath) {
              const innerOpening = innerPath.node.openingElement
              if (
                t.isJSXIdentifier(innerOpening.name, { name: 'link' }) &&
                innerOpening.attributes.some(attr =>
                  t.isJSXAttribute(attr) &&
                  t.isJSXIdentifier(attr.name, { name: 'rel' }) &&
                  attr.value &&
                  ((t.isStringLiteral(attr.value) && attr.value.value === 'stylesheet') ||
                    (t.isJSXExpressionContainer(attr.value) && attr.value.expression.value === 'stylesheet'))
                )
              ) {
                // Find href attribute
                const hrefAttr = innerOpening.attributes.find(attr =>
                  t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name, { name: 'href' })
                )
                if (hrefAttr && hrefAttr.value && t.isStringLiteral(hrefAttr.value)) {
                  stylesheetHrefs.push(hrefAttr.value.value)
                  // Remove this <link> node since we'll replace it with import
                  innerPath.remove()
                }
              }
            }
          })

          // Once processed head, stop traversing JSXElement in this domAst
          path.stop()
        }
      }
    })

    if (stylesheetHrefs.length > 0) {
      // Add import declarations at top of Program body
      const importNodes = stylesheetHrefs.map(href =>
        t.importDeclaration([], t.stringLiteral(href))
      )

      if (domAst.program && Array.isArray(domAst.program.body)) {
        domAst.program.body = [...importNodes, ...domAst.program.body]
      }
    }

          // Remove <head> element from domAst
      traverse(domAst, {
        JSXElement(path) {
          const opening = path.node.openingElement;
          if (t.isJSXIdentifier(opening.name, { name: 'head' })) {
            path.remove();
            path.stop(); // stop traversal after removing the head
          }
        }
      });
  }
}


export { loadComponentAsDOM, writeDOMToJSX, getAST, writeToAST, replaceLinkStylesheetsWithImports };
