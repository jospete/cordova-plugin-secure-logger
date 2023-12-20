#!/usr/bin/env node

/*
Generates a copy script under the `tmp/` directory which
can be used to backfill source files into this repo.

Usage:
node ./scripts/source-copy-cli.js [android|ios] [./relative/path/to/source/files]
*/

const fs = require('fs');
const path = require('path');

function main() {

    const [platform, sourcePath] = process.argv.slice(2);
    const sourceTemplateFileName = `copy-${platform}-template.txt`;
    const sourceTemplatePath = path.resolve(`./dev-assets/${sourceTemplateFileName}`);
    const tempDirName = `./tmp`;
    const tempDirPath = path.resolve(tempDirName);

    if (!fs.existsSync(sourceTemplatePath)) {
        console.error(`invalid platform "${platform}" (file "${sourceTemplateFileName}" does not exist)`);
        return;
    }

    if (!fs.existsSync(tempDirPath)) {
        console.log(`creating temp directory...`);
        fs.mkdirSync(tempDirPath, {recursive: true});
    }

    const outputFileName = `copy-${platform}.sh`;
    const outputFilePath = path.resolve(tempDirPath, outputFileName);
    const templateData = fs.readFileSync(sourceTemplatePath).toString();

    const outputData = templateData
        .replace("${SOURCE_FOLDER_PATH}", sourcePath)
        .replace("${USAGE_EXAMPLE}", `sh ${tempDirName}/${outputFileName}`);

    console.log(`writing copy script to ${outputFilePath}`);
    fs.writeFileSync(outputFilePath, outputData, 'utf8');

    console.log(`Done!`);
}

main();