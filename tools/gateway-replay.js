'use strict';
const fs=require('node:fs'),{analyse,replay}=require('../lib/marstek/gateway-replay');
const file=process.argv[2];if(!file)throw Error('Supply a compact replay JSON or raw observer JSONL file');
const content=fs.readFileSync(file,'utf8');let report;
try{const compact=JSON.parse(content);if(!Array.isArray(compact.rows))throw Error('Not compact replay');report={source:file,summary:compact.summary,decisions:replay(compact),warning:'Gateway real; Venus and export intent synthetic. Not hardware qualification.'};}
catch(e){let malformed=0;const rows=[];for(const line of content.split('\n').filter(Boolean)){try{rows.push(JSON.parse(line));}catch{malformed++;}}report={source:file,malformed,...analyse(rows)};}
if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2));else console.log(JSON.stringify(report,null,2));
