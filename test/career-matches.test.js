'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeMatches,handleCareerMatches,instructions,generateMatches,MATCHING_VERSION}=require('../api/_lib/career-matches');
const input={resume:'EXAMPLE VETERAN\nSupply specialist\nMaintained accurate equipment records and trained colleagues on inventory processes.',additionalDetails:'Used spreadsheets for inventory.'};
const match={code:'vcp-inventory-and-shipping-coordinator',connection:'Experience connection',evidence:'Maintained accurate equipment records',reason:'Your documented inventory records connect to tracking stock.',checkNext:'Check the employer’s inventory software and training requirements.'};
function fixture(options={}){let data={status:'paid',sessionId:'session',includedTemplate:'classic',refinementCount:0,...options.data},generated=0;const saved={document:{...input,design:'classic',applicationType:'private'}};const ref={collection:()=>({doc:()=>({get:async()=>({exists:true,data:()=>saved})})})};const db={runTransaction:async run=>run({get:async()=>({exists:true,data:()=>data}),update:(r,patch)=>{data={...data,...patch};}})};return {get data(){return data;},set data(v){data=v;},saved,get calls(){return generated;},async run(extra={}){const req={body:{consent:true,...extra}},res={code:0,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};await handleCareerMatches({req,res,ref,data,db,uid:'owner',id:'a'.repeat(64),key:'fixture',now:()=>100,stripe:{stripeGet:async()=>({id:'session'})},checkPayment:()=>options.paid!==false,deps:{generateCareerMatches:async value=>{generated++;assert.equal(value.resume,saved.document.resume);if(options.generate)return options.generate(value);return [match];}}});return res;}};}
test('matches must use known occupations and exact applicant evidence; duplicates and invented facts are discarded',()=>{const result=normalizeMatches([match,match,{...match,code:'99-9999.00'},{...match,code:'15-2051.00',evidence:'Managed 500 people'}],input);assert.deepEqual(result,[match]);assert.match(instructions,/protected characteristics/);assert.match(instructions,/not vacancies/);});
test('new AI resume reviews include normalized career matches without requiring another AI request',async()=>{const {normalizeReview,reviewSchema}=await import('../api/_lib/resume-workspace/review.mjs');const result=normalizeReview({score:75,summary:'Clear duties.',strengths:[],suggestions:[],nextSteps:[],revisedResume:input.resume,careerMatches:[match]},input.resume);assert.deepEqual(result.careerMatches,[match]);assert.ok(reviewSchema.required.includes('careerMatches'));});
test('a manual purchased resume is assessed from its saved document and recovered without generating twice',async()=>{const s=fixture();const first=await s.run({resume:'Attacker supplied a different resume'});assert.equal(first.code,200);assert.equal(first.body.source,'finished manual resume');assert.deepEqual(first.body.matches,[match]);const second=await s.run();assert.equal(second.code,200);assert.equal(s.calls,1);assert.ok(s.data.careerAssessment.fingerprint);});
test('an unpaid or unconfirmed request cannot spend AI quota or reserve an assessment',async()=>{const unpaid=fixture({paid:false});assert.equal((await unpaid.run()).code,402);assert.equal(unpaid.calls,0);const noConsent=fixture();assert.equal((await noConsent.run({consent:false})).code,400);assert.equal(noConsent.calls,0);});
test('confirmed manual edits refresh career matches instead of returning stale career evidence',async()=>{const s=fixture();await s.run();s.saved.document.resume+='\nAnother verified duty.';const result=await s.run();assert.equal(result.code,200);assert.equal(result.body.stale,undefined);assert.equal(s.calls,2);});
test('failed generation releases its lease so a retry can recover the same purchase',async()=>{let fail=true;const s=fixture({generate:async()=>{if(fail)throw new Error('Fixture outage');return [match];}});assert.equal((await s.run()).code,503);assert.equal(s.data.careerAssessmentLease,null);fail=false;assert.equal((await s.run()).code,200);assert.equal(s.calls,2);});
test('deletion during assessment cannot resurrect the resume data or career matches',async()=>{let s;s=fixture({generate:async()=>{s.data={...s.data,status:'deleted'};return [match];}});assert.equal((await s.run()).code,409);assert.equal(s.data.careerAssessment,undefined);});
test('career exploration never reuses the short list from a targeted review',async()=>{const s=fixture({data:{status:'complete',input,result:{careerMatches:[match]}}});const result=await s.run();assert.equal(result.code,200);assert.equal(result.body.source,'submitted resume');assert.equal(s.calls,1);assert.equal(s.data.careerAssessment.matchingVersion,MATCHING_VERSION);});

test('expanded matching supports 24 unique evidence-backed roles without padding unsupported suggestions',()=>{
 const catalog=require('../api/_lib/career-catalog.json');const values=catalog.occupations.slice(0,30).map(o=>({...match,code:o.code}));
 assert.equal(normalizeMatches(values,input).length,24);assert.equal(normalizeMatches(values.map(v=>({...v,evidence:'Invented unsupported experience'})),input).length,0);
 assert.match(instructions,/up to 24/);assert.match(instructions,/Never add an unsupported career/);
});
test('explicit expansion of an earlier short review generates and recovers a broad career assessment',async()=>{
 const s=fixture({data:{status:'complete',input,result:{careerMatches:[match]}}});assert.equal((await s.run({expand:true})).code,200);assert.equal(s.calls,1);assert.equal((await s.run({expand:true})).code,200);assert.equal(s.calls,1);
});

test('formatting differences in extracted PDF evidence keep original passages, while changed facts are rejected',()=>{
 const source={resume:'📋 EXAMPLE\nManaged 20 people across\n two teams; maintained oﬃce records and “front-line” schedules.'};
 const items=[{...match,evidence:'managed 20 people across two teams'},{...match,code:'vcp-office-support-coordinator',evidence:'maintained office records and "front-line" schedules'},{...match,code:'vcp-administrative-operations-manager',evidence:'Managed 200 people across two teams'}];
 const actual=normalizeMatches(items,source);assert.equal(actual.length,2);assert.equal(actual[0].evidence,'Managed 20 people across\n two teams');assert.equal(actual[1].evidence,'maintained oﬃce records and “front-line” schedules');assert.ok(actual.every(m=>source.resume.includes(m.evidence)));
 assert.deepEqual(normalizeMatches([{...match,evidence:'Managed teams and office records'}],source),[]);
});
test('target jobs never enter the independent generator or change its cached assessment',async()=>{
 const s=fixture({data:{input:{...input,role:'Data scientist',jobDescription:'Only data jobs',applicationType:'private'}},generate:async value=>{assert.deepEqual(Object.keys(value).sort(),['additionalDetails','resume']);assert.ok(!JSON.stringify(value).includes('Data scientist'));return [match];}});
 await s.run();s.data={...s.data,input:{...s.data.input,role:'Warehouse manager',jobDescription:'Only logistics jobs'}};await s.run();assert.equal(s.calls,1);
});
test('an old catalog-only cache is replaced once with an independent whole-background result',async()=>{
 const s=fixture({data:{input,careerAssessment:{matches:[match],catalogVersion:require('../api/_lib/career-catalog.json').version}}});await s.run();await s.run();assert.equal(s.calls,1);assert.equal(s.data.careerAssessment.matchingVersion,MATCHING_VERSION);
});
test('a second look recovers overlooked fields without weakening evidence or sending target-job information',async()=>{
 const previousFetch=global.fetch,previousKey=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='fictional-test-key';const requests=[];
 const catalog=require('../api/_lib/career-catalog.json'),selected=[...new Map(catalog.occupations.map(o=>[o.category,o])).values()].slice(0,12);
 const facts=selected.map((o,i)=>'Verified responsibility number '+i+' included maintaining records, coordinating people and training teams.');
 const source={resume:'EXAMPLE APPLICANT\n'+facts.join('\n')+'\nOther documented work. '.repeat(30),role:'TARGET MUST NOT BE SENT',jobDescription:'TARGET ANNOUNCEMENT'};
 const candidate=(o,i)=>({...match,code:o.code,evidence:facts[i]});
 global.fetch=async(url,request)=>{requests.push(JSON.parse(request.body));const matches=requests.length===1?selected.slice(0,2).map(candidate):selected.map(candidate);return {ok:true,json:async()=>({output:[{content:[{type:'output_text',text:JSON.stringify({matches})}]}]})};};
 try{const results=await generateMatches(source);assert.equal(requests.length,2);assert.equal(results.length,12);assert.equal(new Set(results.map(m=>catalog.occupations.find(o=>o.code===m.code).category)).size,12);assert.ok(results.every(m=>source.resume.includes(m.evidence)));for(const request of requests){assert.ok(!request.input.includes('TARGET'));assert.equal(request.store,false);assert.match(request.instructions,/ENTIRE resume/);}}finally{global.fetch=previousFetch;if(previousKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previousKey;}
});

test('the provider schema constrains every evidence choice to unchanged original source passages',async()=>{
 const previousFetch=global.fetch,previousKey=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='fictional-test-key';let request;
 global.fetch=async(url,options)=>{request=JSON.parse(options.body);return {ok:true,json:async()=>({output:[{content:[{type:'output_text',text:JSON.stringify({matches:[match]})}]}]})};};
 try{await generateMatches({...input,role:'TARGET NOT TO SEND'});const facts=JSON.parse(request.input);assert.ok(facts.evidencePassages.every(p=>(input.resume+'\n'+input.additionalDetails).includes(p)));assert.deepEqual(request.text.format.schema.properties.matches.items.properties.evidence.enum,facts.evidencePassages);assert.ok(!JSON.stringify(facts).includes('TARGET'));}finally{global.fetch=previousFetch;if(previousKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previousKey;}
});
test('evidence choices retain later resume sections, original typography and unbroken source passages',()=>{
 const {evidencePassages}=require('../api/_lib/career-evidence');const source='First duty: maintained records.\r\nA second duty with “quotes” and oﬃce records.\n'+('Long verified detail '.repeat(100))+'\nFINAL DUTY: coached new employees.';const passages=evidencePassages(source);assert.ok(passages.every(p=>source.includes(p)&&p.length<=1000));assert.ok(passages.some(p=>p.includes('FINAL DUTY')));assert.ok(passages.some(p=>p.includes('oﬃce')));
 const shortLines=Array.from({length:600},(_,i)=>'Verified '+i).join('\n');const compact=evidencePassages(shortLines);assert.ok(compact.length<=512);assert.ok(compact.every(p=>shortLines.includes(p)));assert.ok(compact.some(p=>p.includes('Verified 599')));
});
