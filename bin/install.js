#!/usr/bin/env node
import fs from 'fs';

const defaultConfig = `
export default {
  inputDir: 'src', // Write all your vanilla content here
  outputDir: 'dist', // This is where the converted files will be created
  dontFlatten: false, // Keep compound selectors rather than automatic BEM-style flattening
  useNumbers: true, // Use numbers (1, 2, 3, 4) instead of hash (3d0ccd)
  dontHashFirst: true, // The first scope of a certain type doesn't get an ID or hash
  mergeCss: false, // Merge all the CSS into one file
  teamGit: '', //The git repo of the team/main project (private mode)
  teamSrc: false, // Team src folder/s to scan for class names already used
  copyFiles: true, // Copy rest of files directly to output, as they are
  globalCss: '', //Css that should not be scoped and only copied as is 
  flattenCombis: [], //Flatten combinators, e.g. > becomes _a_
  overrideConfig: {}, //Override config for specific scopes
};
  `;

  
let gitIgnore = '';

if (fs.existsSync ('.gitignore'))
    gitIgnore = fs.readFileSync ('.gitignore') + '\n';


gitIgnore += `/dist
/dev-temp
/auto-scope/renameCache
/auto-scope/suffixes-private`

fs.writeFileSync ('.gitignore', gitIgnore);


let gitAttributes = '';
if(fs.existsSync ('.gitattributes'))
  gitAttributes = fs.readFileSync ('.gitattributes') + '\n';

gitAttributes += 'auto-scope/suffixes/*.json merge=keepTheirs';

let gitConfig = '';
if (fs.existsSync ('.git/config'))
  gitConfig = fs.readFileSync ('.git/config');

gitConfig += `[merge "keepTheirs"]
    name = Always keep theirs
    driver = true`

fs.writeFileSync ('auto-scope.config.js', defaultConfig);
  