#!/usr/bin/env node

/*
Commits all unstaged content, tags it with the
current version in package.json, and pushes
the changes and tag to github.

Usage:
node ./scripts/version-publish.js
*/

const {execSync} = require('child_process');
const {version} = require('../package.json');

function git(cmd) {
    const output = `git ${cmd}`;
    console.log(`> ${output}`);
    return execSync(output);
}

function getCurrentBranchName() {
    const output = git('status').toString();
    const matched = /On branch (\S+)/.exec(output);
    return matched ? matched[1] : undefined;
}

function main() {

    git(`add .`);
    git(`commit -m "v${version}"`);
    git(`tag ${version}`);

    const currentBranch = getCurrentBranchName();
    let pushCommand = `push -u origin --tags`;

    if (currentBranch) {
        pushCommand += ` ${currentBranch}`;
    }

    git(pushCommand);
}

main();