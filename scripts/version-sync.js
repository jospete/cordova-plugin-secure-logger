#!/usr/bin/env node

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
}

main();