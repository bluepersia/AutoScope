import fs from 'fs';
import path from 'path';
import parser from 'recast/parsers/babel.js';
import generateModule from '@babel/generator';
const generate = generateModule.default;
import traverseModule from '@babel/traverse';
const traverse = traverseModule.default;
import { parseDocument } from 'htmlparser2';
import { default as serialize } from 'dom-serializer';
import * as t from '@babel/types';
import recast from 'recast';
import * as babelParser from '@babel/parser';

export async function getAST(srcPath) {
  const code = await fs.promises.readFile(srcPath, 'utf8');
  const ast = recast.parse (code, { parser });

  ast.doms = [];
  ast.autoScopeArray;
  ast.filePath = srcPath;
  ast.raw = code;

  traverse(ast, {
    FunctionDeclaration(path) {
      if (path.node.id?.name === 'getScopedHtml') {
        const tpl = extractReturnValue(path);
        if (tpl) ast.doms.push({ node: tpl, dom: toDom(templateLiteralToHtml(tpl)) });
      }
    },
    ClassMethod(path) {
      if (path.node.key.name === 'getScopedHtml') {
        const tpl = extractReturnValue(path);
        if (tpl) ast.doms.push({ node: tpl, dom: toDom(templateLiteralToHtml(tpl)) });
      }
    },
    ObjectMethod(path) {
      if (path.node.key.name === 'getScopedHtml') {
        const tpl = extractReturnValue(path);
        if (tpl) ast.doms.push({ node: tpl, dom: toDom(templateLiteralToHtml(tpl)) });
      }
    },
    VariableDeclarator(path) {
      if (path.node.id.name === 'autoScope' && path.node.init.type === 'ArrayExpression') {
        ast.autoScopeArray = path.node.init.elements.map(el => {
          if (el.type === 'StringLiteral' || el.type === 'NumericLiteral') return el.value;
          throw new Error(`Unsupported element type: ${el.type}`);
        });
      }

      if (
        path.node.id.name === 'getScopedHtml' &&
        (t.isFunctionExpression(path.node.init) || t.isArrowFunctionExpression(path.node.init))
      ) {
        const tpl = extractReturnValue(path.get('init'));
        if (tpl) ast.doms.push({ node: tpl, dom: toDom(templateLiteralToHtml(tpl)) });
      }
    }
  });

  ast.doms.forEach(d => {
    d.dom.isJs = true;
    d.dom.filePath = ast.filePath;
  });
  
  function toDom(htmlString) {
    const placeholders = [];
    const safeHtml = htmlString.replace(/\$\{([^}]+)\}/g, (_, expr) => {
      const id = `__EXPR_${placeholders.length}__`;
      placeholders.push(expr.trim());
      return id;
    });
  
    const dom = parseDocument(safeHtml);
    dom._placeholders = placeholders; // store with DOM for later rehydration
    return dom;
  }
  return ast;
}

function extractReturnValue(path) {
    let returnNode = null;
    path.traverse({
      ReturnStatement(returnPath) {
        if (!returnNode) returnNode = returnPath.node.argument;
      },
    });
  
    if (returnNode?.type === 'TemplateLiteral') {
      return returnNode;  // Return the whole node, not just strings joined
    } else if (returnNode?.type === 'StringLiteral') {
      return returnNode.value;
    }
    return null;
  }


function templateLiteralToHtml(tpl) {
  let html = '';
  tpl.quasis.forEach((q, i) => {
    html += q.value.cooked;
    if (i < tpl.expressions.length) {
      html += `\${${generate(tpl.expressions[i]).code}}`;
    }
  });
  return html;
}

export async function writeToAST(ast) {
  let tplIndex = 0;

  traverse(ast, {
    FunctionDeclaration(path) {
      if (path.node.id?.name === 'getScopedHtml') {
        const { node: tpl, dom } = ast.domClones[tplIndex++];
        reinsertDom(path, dom);
      }
    },
    ClassMethod(path) {
      if (path.node.key.name === 'getScopedHtml') {
        const { node: tpl, dom } = ast.domClones[tplIndex++];
        reinsertDom(path, dom);
      }
    },
    ObjectMethod(path) {
      if (path.node.key.name === 'getScopedHtml') {
        const { node: tpl, dom } = ast.domClones[tplIndex++];
        reinsertDom(path, dom);
      }
    },
    VariableDeclarator(path) {
      if (
        path.node.id.name === 'getScopedHtml' &&
        (t.isFunctionExpression(path.node.init) || t.isArrowFunctionExpression(path.node.init))
      ) {
        const { node: tpl, dom } = ast.doms[tplIndex++];
        reinsertDom(path.get('init'), dom);
      }

      if (path.node.id.name === 'autoScope') {
        const parent = path.parentPath;
        if (t.isVariableDeclaration(parent.node)) {
          if (parent.node.declarations.length === 1) {
            parent.remove();
          } else {
            path.remove();
          }
        } else {
          path.remove();
        }
      }
    }
  });

  return recast.print(ast).code;
}
function reinsertDom(path, dom) {
    const html = serialize(dom);
    let reconstructedHtml = html;
  
    if (dom._placeholders?.length) {
      dom._placeholders.forEach((expr, index) => {
        const placeholder = `__EXPR_${index}__`;
        reconstructedHtml = reconstructedHtml.replace(placeholder, `\${${expr}}`);
      });
    }
  
    const tpl = htmlToTemplateLiteral(reconstructedHtml);
  
    path.traverse({
      ReturnStatement(returnPath) {
        returnPath.node.argument = tpl;
      }
    });
  }

  function htmlToTemplateLiteral(html) {
    const parts = html.split(/\$\{([^}]+)\}/g);
    const quasis = [];
    const expressions = [];
  
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) {
        quasis.push(t.templateElement({ raw: parts[i], cooked: parts[i] }, i === parts.length - 1));
      } else {
        const exprAst = babelParser.parseExpression(parts[i].trim());
        expressions.push(exprAst);
      }
    }
  
    return t.templateLiteral(quasis, expressions);
  }