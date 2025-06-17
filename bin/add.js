#!/usr/bin/env node
import simpleGit from 'simple-git';
import loadConfig from './loadConfig.js';
const config = await loadConfig();
const myGit = simpleGit(process.cwd());
const teamGit = simpleGit(`${process.cwd()}/${config.teamGit}`);

let add;
const args = process.argv.slice(2); // Skip first two elements (node and script path)


args.forEach((arg, index) => {
  add = arg;
});


async function main() {
  await myGit.add(add);
  await teamGit.add(add);
}

main();
