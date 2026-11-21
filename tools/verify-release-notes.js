'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),root=path.join(__dirname,'..');
assert.equal(JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,'4.2.3-beta.3');
const notes=fs.readFileSync(path.join(root,'RELEASE_NOTES.md'),'utf8');
assert.match(notes,/^# GivHome 4\.2\.3-beta\.3/);
assert.match(notes,/Venus household-support recovery after Local API timeouts/);
assert(fs.existsSync(path.join(root,'docs/MARSTEK_SETUP.md')));
if (process.argv.includes('--github-body')) process.stdout.write(notes.replace(/^# .*\n\n/, ''));
else console.log('PASS stable release notes and setup guide');
