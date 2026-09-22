import{execFileSync}from'node:child_process';import{mkdir,cp,access}from'node:fs/promises';import{resolve}from'node:path';
const output=resolve(process.env.CATALOG_OUTPUT||'public/data');await mkdir(output,{recursive:true});
try{await access(resolve(output,'index.json'));}catch{if(output!==resolve('public/data'))await cp(resolve('public/data'),output,{recursive:true});}
const full=process.argv.includes('--full');
// A failed stage exits before the workflow commits anything. Published readers
// see either the complete previous git revision or the complete next revision.
const run=(script,args=[])=>execFileSync(process.execPath,['--experimental-strip-types','scripts/'+script,...args],{stdio:'inherit',env:{...process.env,CATALOG_OUTPUT:output}});
if(full){run('bootstrap-series.mjs');run('series-facts.mjs');run('build-series.mjs');run('backfill-editions.mjs');run('backfill-official-groups.mjs');}
if(full||process.argv.includes('--platforms'))run('refresh-platforms.mjs');
if(full)run('normalize-series.mjs');
if(full||process.argv.includes('--assets'))run('enrich-series-assets.mjs');
run('refresh-news-snapshot.mjs',process.argv.includes('--bootstrap')?['--bootstrap']:[]);
run('validate-public-data.mjs');
