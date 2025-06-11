#!/usr/bin/env node
import path from 'path';
import {
  initInputCss,
  initInputHtml,
  initCombinatorFlattening,
  initInputReact,
  initTeamRepoHashMap,
  initFormatters,
  checkDevMode,
  build,
  init,
} from '../index.js';
import { setConfig, copyFiles, state } from '../shared.js';
import { syncTeamRepo } from '../main/teamRepo.js';
import { default as inquirer } from 'inquirer';
import fsExtra from 'fs-extra';
import http from 'http';
import { globby } from 'globby';
import postcss from 'postcss';
import fs from 'fs/promises';
import fsDefault from 'fs';
import fg from 'fast-glob';
import simpleGit from 'simple-git';
import loadConfig from './loadConfig.js';

const git = simpleGit(process.cwd());
let currentBranch;

const args = process.argv.slice(2); // Skip first two elements (node and script path)

let name;

args.forEach((arg, index) => {
  if (arg === '--name' && args[index + 1]) {
    name = args[index + 1];
  }
});

const config = (state.config = await loadConfig());
await initInputCss(config);
await initInputHtml(config);
await initInputReact(config);
await initCombinatorFlattening(config);
await initFormatters();
state.config.initOutputDir = state.config.outputDir;
state.config.initUsePrettier = state.config.usePrettier;

checkDevMode(pull);

let devMode;
async function pull(devMd = false) {
  devMode = devMd;

  if (!(await main())) return;

  await syncTeamRepo(state.config, (name && [name]) || [], null, 'merge');

  await fsExtra.remove('merge');

  if (!devMode && !name) {
    await build(state.config);
  }
  await git.add('.');
  await git.commit('Commit final build');
  await git.checkout('master');
  await fsExtra.remove('merge');
  await git.add('.');
  await git.commit('Commit master');
  await git.checkout(currentBranch);
}

async function readFileSafe(filepath) {
  try {
    return await fs.readFile(filepath, 'utf8');
  } catch {
    return '';
  }
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
      const className = m[0].slice(1);
      results.push({ className, hash });
    }
  }

  return results;
}

function htmlUsesClass(htmlContent, className) {
  const regex = new RegExp(`class=["'][^"']*\\b${className}\\b[^"']*["']`, 'i');
  return regex.test(htmlContent);
}

async function main() {
  const cwd = process.cwd();

  const inputDir = state.config.inputDir;
  if (!inputDir) {
    console.error('Usage: node sync-check.js <inputDir>');
    process.exit(1);
  }

  /*
  const htmlFiles = allFilesBefore.filter((f) => f.endsWith(".html"));
  const htmlUsingHash = new Set();
  for (const htmlFile of htmlFiles) {
    const content = await readFileSafe(path.join(cwd, htmlFile));
    for (const { className } of scopeHashes) {
      if (htmlUsesClass(content, className)) {
        htmlUsingHash.add(htmlFile);
        break;
      }
    }
  }*/

  //await build(config);

  /*
  if (devMode) {
    copyFiles('dev-temp', config.outputDir);
    await copyGlobalCss('dev-temp', config.outputDir);
  }*/

  currentBranch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();

  if (currentBranch === 'master')
    throw Error(
      'You are already on the master branch! To do a dev-pull, you must be on a different branch for merging.'
    );

  const allFilesBefore = await fg([`${state.config.teamRepo}/**/*`], {
    cwd,
    dot: true,
    onlyFiles: true,
  });

  const cssFiles = allFilesBefore.filter((f) => f.endsWith('.css'));
  const scopeHashes = [];
  for (const cssFile of cssFiles) {
    const content = await readFileSafe(path.join(cwd, cssFile));
    const hashes = parseCssScopeHashes(content);
    scopeHashes.push(...hashes);
  }

  await git.add('.');
  await git.commit('Save current branch changes before switching');
  await git.checkout('master');

  await fsExtra.copy(state.config.teamRepo, 'merge', {
    filter: (src) => {
      const rel = path.relative(state.config.teamRepo, src);
      return !rel.startsWith('.git'); // skip .git and anything inside
    },
  });

  try {
    await git.pull('origin', 'master');
  } catch (err) {
    console.error('Git pull failed:', err);
    await fsExtra.remove('merge');
  }

  async function readFilesAfter() {
    const allFilesAfter = await fg([`${state.config.teamRepo}/**/*`], {
      cwd,
      dot: true,
      onlyFiles: true,
    });

    const cssFilesAfter = allFilesAfter.filter((f) => f.endsWith('.css'));
    const scopeHashesAfter = [];
    for (const cssFile of cssFilesAfter) {
      const content = await readFileSafe(path.join(cwd, cssFile));
      const hashes = parseCssScopeHashes(content);
      scopeHashesAfter.push(...hashes);
    }

    const afterHashArr = scopeHashesAfter.map((h) => h.hash);

    return { afterHashArr, allFilesAfter };
  }

  let after = await readFilesAfter();

  const hashesAdded = after.afterHashArr.filter(
    (h) => !scopeHashes.find((obj) => obj.hash === h)
  );

  /*
  if (config.teamRepo !== config.outputDir) {
    if (fsDefault.existsSync(config.outputDir))
      await fs.rm(config.outputDir, { recursive: true, force: true });

    await fsExtra.copy(config.teamRepo, config.outputDir);
  }
*/

  await git.add('.');

  await git.commit('Save master before returning');

  await git.checkout(currentBranch);

  let myCssFiles;

  let collisionOccured = false;
  if (hashesAdded.length > 0) {
    myCssFiles = await globby(state.config.inputCss);

    for (const cssFile of myCssFiles) {
      const css = await fs.readFile(cssFile, 'utf-8');

      for (const hashAdded of hashesAdded) {
        if (
          css.includes(`--scope-hash:${hashAdded}`) ||
          css.includes(`--scope-hash: ${hashAdded}`)
        ) {
          collisionOccured = true;
          //console.warn (`Hash ${hashAdded} is already used. Resetting ${cssFile}.`)
          const root = postcss.parse(css, { from: cssFile });

          root.walkRules((rule) => {
            rule.walkDecls('--scope-hash', (decl) => {
              const next = decl.next();

              // Check if next node is a comment and on the same line
              if (
                next &&
                next.type === 'comment' &&
                next.source.start.line === decl.source.end.line
              ) {
                next.remove();
              }

              decl.remove();
            });
          });

          await fs.writeFile(cssFile, root.toString(), 'utf-8');
        }
      }
    }
  }

  if (collisionOccured) {
    await fsExtra.remove('merge');
    await pull();
    return;
  }

  try {
    await git.merge(['master']);
  } catch (e) {
    console.warn('Team repo merge conflicts detected. Please resolve them.');

    const { confirmMerge } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmMerge',
        message: 'Has the merge been resolved?',
        default: false,
      },
    ]);

    if (!confirmMerge) return;

    await git.add('.');
    await git.commit('Resolve merge conflicts');
  }

  await initTeamRepoHashMap();

  after = await readFilesAfter();

  const beforeHashMap = new Map(scopeHashes.map((h) => [h.hash, h])); // map hash -> object
  const filesDeleted = allFilesBefore
    .filter((f) => !f.endsWith('.css') && !after.allFilesAfter.includes(f))
    .map((p) => path.join(config.inputDir, path.relative(config.teamRepo, p)));

  const hashDeleted = [...beforeHashMap.entries()]
    .filter(([hash]) => !after.afterHashArr.includes(hash))
    .map(([hash, { className }]) => ({
      hash,
      scopeName: className.replace(/-\w+$/, ''),
    }));

  /*
  if (devMode)
    await fsExtra.copy(config.outputDir, 'dev-temp', { overwrite: true });
*/
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
          await fs.unlink(fileRel);
          console.log(`Deleted file: ${fileRel}`);
        } catch (err) {
          console.warn(`Failed to delete ${fileRel}: ${err.message}`);
        }
      }
    }
  }

  if (hashDeleted.length > 0) {
    if (!myCssFiles) myCssFiles = await globby(state.config.inputCss);

    const deletedFiles = [];

    for (const { hash } of hashDeleted) {
      for (const srcPath of myCssFiles) {
        const content = await fs.promises.readFile(srcPath, 'utf8');
        if (
          content.includes(`--scope-hash: ${hash}`) ||
          content.includes(`--scope-hash:${hash}`)
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
            await fs.unlink(deletedFile);
          } finally {
          }
        }
      }
    }
  }

  state.config.outputDir = 'merge';
  state.forceCssFormatting = true;
  await build(state.config);
  state.config.outputDir = state.config.initOutputDir;
  state.forceCssFormatting = false;

  await git.add(['merge/**/*']);
  await git.commit('Commit build.');

  await git.checkout('master');
  await fsExtra.copy(state.config.teamRepo, 'merge');

  const mergeHtmlFiles = await globby('merge/**/*.html');
  const mergeCssFiles = await globby('merge/**/*.css');
  const mergeReactFiles = await globby(['merge/**/*.jsx', 'merge/**/*.tsx']);

  for (const htmlFile of mergeHtmlFiles) {
    const html = await fs.readFile(htmlFile, 'utf-8');
    const out = await state.htmlFormatter(html);
    await fs.writeFile(htmlFile, out);
  }
  for (const cssFile of mergeCssFiles) {
    const css = await fs.readFile(cssFile, 'utf-8');
    const out = await state.cssFormatter(css);
    await fs.writeFile(cssFile, out);
  }
  for (const reactFile of mergeReactFiles) {
    const react = await fs.readFile(reactFile, 'utf-8');
    const out = reactFile.endsWith('.jsx')
      ? await state.jsFormatter(react)
      : await state.tsFormatter(react);
    await fs.writeFile(reactFile, out);
  }

  await git.add(['merge/**/*']);
  await git.commit('Commit merge team repo');

  await git.checkout(currentBranch);

  try {
    await git.merge(['master']);
  } catch (e) {
    console.warn(
      'Merge conflicts in build detected. Resolve them in the merge folder.'
    );

    const { confirmMerge } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmMerge',
        message: 'Has the merge been resolved?',
        default: false,
      },
    ]);

    if (!confirmMerge) return;

    await git.add('.');
    await git.commit('Resolve merge conflicts');
  }

  /*
  const htmlDeleted = [];
  for (const htmlFile of htmlUsingHash) {
    const contentAfter = await readFileSafe(path.join(cwd, htmlFile));

    // A) Does it still use _any_ of the original classes?
    let stillUsesAny = false;
    for (const { className } of scopeHashes) {
      if (htmlUsesClass(contentAfter, className)) {
        stillUsesAny = true;
        break;
      }
    }
    if (!stillUsesAny) {
      // never uses any scoped class any more
      htmlDeleted.push(htmlFile);
      continue;
    }

    // B) Even if it still uses some classes, does it use one whose hash was deleted?
    //    (i.e. className was in scopeHashes, but its hash is in hashDeleted)
    let usesRemovedHash = false;
    for (const { className, hash } of scopeHashes) {
      if (hashDeleted.includes(hash) && htmlUsesClass(contentAfter, className)) {
        usesRemovedHash = true;
        break;
      }
    }
    if (usesRemovedHash) {
      htmlDeleted.push(htmlFile);
    }
  }
*/
  return { filesDeleted, hashDeleted };
}
