#!/usr/bin/env node

/*
Automates changes needed for iOS source files after
they have been backfilled into this repo from a test xcode project.

Usage:
node ./scripts/fix-ios-source-imports.js
*/

const fs = require('fs');
const path = require('path');

// the "import Cordova" header is tacked on by capacitor, so 
// need to remove it from source when copying back into this repo
function removeCordovaImports(sourceFilePath) {
    console.log(`stripping duplicate imports for ${sourceFilePath}`);
    const data = fs.readFileSync(sourceFilePath).toString();
    const updated = data.replace(/import Cordova[\n\r\f]+/gm, '');
    fs.writeFileSync(sourceFilePath, updated, 'utf8');
}

function main() {

    const iosSourcePath = path.resolve(process.cwd(), 'src', 'ios');
    const files = fs.readdirSync(iosSourcePath, {withFileTypes: true})
        .filter(v => v.isFile())
        .map(v => path.resolve(iosSourcePath, v.name));

    for (const sourceFile of files) {
        removeCordovaImports(sourceFile);
    }
}

main();