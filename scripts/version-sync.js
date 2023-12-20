#!/usr/bin/env node

/*
Applies the version set by the `npm version` command
to other source files which require version metadata
(e.g. the cordova plugin.xml file)

Usage:
node ./scripts/version-sync.js
*/

const fs = require('fs');
const {version} = require('../package.json');

function updateFileVersionRefs(filePath, replaceRegex, replacer) {
    let fileData = fs.readFileSync(filePath).toString();
    fileData = fileData.replace(replaceRegex, replacer);
    fs.writeFileSync(filePath, fileData);
}

function main() {
    updateFileVersionRefs(`./plugin.xml`, /(<plugin.*version=")([^"]+)(".*)/, `$1${version}$3`);
    updateFileVersionRefs(`./README.md`, /(cordova-plugin-secure-logger.git#)([\d\.]+)/gm, `$1${version}`);
    updateFileVersionRefs(`./README.md`, /(cordova-plugin-secure-logger@)([\d\.]+)/gm, `$1${version}`);
}

main();