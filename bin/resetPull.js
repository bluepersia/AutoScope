import simpleGit from 'simple-git';
const myGit = simpleGit(process.cwd());
const teamGit = simpleGit(`${process.cwd()}/${config.teamRepo}`);

async function main() {
  currentBranch = (await teamGit.revparse(['--abbrev-ref', 'HEAD'])).trim();

  if (currentBranch === 'master')
    throw Error(
      'You are on the master branch! To do a pull backup, you must be on the branch where you initiated the pull'
    );

  await myGit.reset(['--hard', 'pull-backup']);
  await teamGit.reset(['--hard', 'pull-backup']);
  await myGit.deleteLocalBranch('merge');
  await teamGit.checkout('master');
  await teamGit.reset(['--hard', 'pull-backup']);
  await teamGit.checkout(currentBranch);
}

main();
