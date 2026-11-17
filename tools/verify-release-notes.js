'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),root=path.join(__dirname,'..');
assert.equal(JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,'4.2.0');
const notes=fs.readFileSync(path.join(root,'RELEASE_NOTES.md'),'utf8');
assert.match(notes,/^# GivHome 4\.2\.0/);
assert.match(notes,/docs\/MARSTEK_SETUP\.md/);
assert(fs.existsSync(path.join(root,'docs/MARSTEK_SETUP.md')));
console.log('PASS stable release notes and setup guide');
