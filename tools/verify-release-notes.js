'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),root=path.join(__dirname,'..');
assert.equal(JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,'4.2.0-beta.1');
assert.equal(fs.readFileSync(path.join(root,'RELEASE_NOTES.md'),'utf8'),'Beta Marstek Addon. Not for public use\n');
console.log('PASS exact private beta release note');
