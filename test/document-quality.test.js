'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {cvSkillGroups,cleanPublicCv}=require('../api/_lib/cv-content');
const {organizeSkillGroups}=require('../api/_lib/skill-organization');
const backgrounds=require('./fixtures/skill-backgrounds.json');
for(const fixture of backgrounds)test('skills remain complete and functionally grouped: '+fixture.background,()=>{
 const input={name:'Example Veteran',skills:{technical:fixture.skills.join(', ')}},copy=structuredClone(input),groups=cvSkillGroups(input.skills.technical);
 assert.deepEqual(groups.flatMap(group=>group.items).sort(),[...fixture.skills].sort());assert.deepEqual(groups.map(group=>group.title).sort(),[...fixture.categories].sort());
 const organized=cleanPublicCv(input);assert.deepEqual(cleanPublicCv(organized),organized);assert.deepEqual(input,copy);
 assert.doesNotMatch(JSON.stringify(organized),/licensed|certified|expert|active clearance|commercial driver/i);
});
test('custom categories win over broad automatic categories and wrapped words remain complete',()=>{
 const groups=organizeSkillGroups([{title:'Core skills',items:['Excel','SQL']},{title:'Clinical research tools',items:['Excel']},{title:'Core skills',items:['SQL']}]);
 assert.equal(groups.flatMap(group=>group.items).filter(item=>item==='Excel').length,1);assert.deepEqual(groups.find(group=>group.title==='Clinical research tools').items,['Excel']);
 assert.deepEqual(cvSkillGroups('Operations: vendor\nmanagement, process\nimprovement, standard operating\nprocedures (SOPs)')[0].items,['vendor management','process improvement','standard operating procedures (SOPs)']);
 const groupsWithBrand=cvSkillGroups('Enterprise Platforms: SAP, NetSuite\nManhattan WMS Operations: cycle counts');assert.deepEqual(groupsWithBrand[0].items,['SAP','NetSuite','Manhattan WMS']);assert.equal(groupsWithBrand[1].title,'Operations');
});
test('ambiguous and learning-status skills remain neutral instead of implying unsupported experience',()=>{
 const items=['incident response','risk assessment','Learning SAP','No licensed nursing experience'];const groups=cvSkillGroups(items.join(', '));assert.deepEqual(groups,[{title:'Additional skills',items}]);
 assert.deepEqual(cvSkillGroups('Emergency response: incident response')[0],{title:'Emergency response',items:['incident response']});
});
const requestOptions={apiKey:'fixture-only-key',instructions:'Write from supplied facts.',input:JSON.stringify({resume:'Example applicant facts.'}),schema:{type:'object',properties:{},additionalProperties:false},name:'document_fixture',maxOutputTokens:5000};
test('document requests use the flagship structured writer and never store provider content',async()=>{
 const {requestDocument,DEFAULT_DOCUMENT_MODEL}=await import('../api/_lib/resume-workspace/document-ai.mjs');let body;
 await requestDocument({...requestOptions,fetcher:async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');body=JSON.parse(options.body);return new Response('{}');}});
 assert.equal(body.model,DEFAULT_DOCUMENT_MODEL);assert.equal(body.model,'gpt-5.4');assert.deepEqual(body.reasoning,{effort:'low'});assert.equal(body.store,false);assert.equal(body.text.format.strict,true);assert.equal(body.input,requestOptions.input);
});
test('only an explicit model-access failure gets a fallback within the same deadline',async()=>{
 const {requestDocument}=await import('../api/_lib/resume-workspace/document-ai.mjs');const controller=new AbortController(),calls=[];
 await requestDocument({...requestOptions,signal:controller.signal,fetcher:async(url,options)=>{calls.push(JSON.parse(options.body));assert.equal(options.signal,controller.signal);return calls.length===1?new Response(JSON.stringify({error:{code:'model_not_found',message:'PRIVATE_PROVIDER_MESSAGE'}}),{status:404}):new Response('{}');}});
 assert.equal(calls.length,2);assert.equal(calls[0].model,'gpt-5.4');assert.equal(calls[1].model,'gpt-4.1-mini');assert.equal('reasoning' in calls[1],false);for(const key of ['input','instructions','text','store'])assert.deepEqual(calls[0][key],calls[1][key]);
 for(const [status,code]of [[400,'invalid_request_error'],[401,'invalid_api_key'],[403,'insufficient_permissions'],[429,'insufficient_quota'],[500,'server_error']]){let attempts=0;const response=await requestDocument({...requestOptions,fetcher:async()=>{attempts++;return new Response(JSON.stringify({error:{code}}),{status});}});assert.equal(response.status,status);assert.equal(attempts,1);}
});
test('model overrides remain available and cancelled or transport-failed requests do not restart',async()=>{
 const {requestDocument}=await import('../api/_lib/resume-workspace/document-ai.mjs');let attempts=0;
 await requestDocument({...requestOptions,model:'gpt-4.1',fetcher:async(url,options)=>{assert.equal(JSON.parse(options.body).model,'gpt-4.1');assert.equal('reasoning' in JSON.parse(options.body),false);return new Response('{}');}});
 await assert.rejects(requestDocument({...requestOptions,fetcher:async()=>{attempts++;throw new Error('transport');}}),/transport/);assert.equal(attempts,1);
 const controller=new AbortController();controller.abort();attempts=0;
 await requestDocument({...requestOptions,signal:controller.signal,fetcher:async()=>{attempts++;return new Response(JSON.stringify({error:{code:'model_not_found'}}),{status:404});}});assert.equal(attempts,1);
});
test('resume, cover-letter and skills-translation adapters use the same writing policy',async t=>{
 const before=process.env.OPENAI_API_KEY;t.after(()=>{if(before===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=before;});process.env.OPENAI_API_KEY='fixture-only-key';
 const input={resume:'ALEX EXAMPLE\nU.S. Navy supply clerk. Maintained equipment records, used NetSuite, reconciled inventory and trained 3 colleagues.',role:'Supply planner',company:'Example Company',additionalDetails:'Used Oracle SCM at a separate employer.',applicationType:'private',jobDescription:'Coordinate supply records and use SAP.'},calls=[];
 const review={score:70,summary:'Clarify the supplied examples.',strengths:[],suggestions:[],nextSteps:[],revisedResume:input.resume,rewriteNotes:[],findings:[],careerMatches:[]};
 const letter={coverLetter:'Dear Hiring Team,\n\nI am applying for the supply planner role. I maintained equipment records, reconciled inventory and trained 3 colleagues.\n\nALEX EXAMPLE',checks:['Confirm the employer details.']};
 const kit={summary:'Translate the supplied duties.',qualifications:[],translations:[],coverLetter:'',checks:[]};
 t.mock.method(globalThis,'fetch',async(url,options)=>{const body=JSON.parse(options.body);calls.push(body);const value={resume_review:review,cover_letter:letter,career_kit:kit}[body.text.format.name];return new Response(JSON.stringify({output:[{content:[{type:'output_text',text:JSON.stringify(value)}]}]}));});
 await (await import('../api/_lib/resume-workspace/review.mjs')).reviewResume(input,{apiKey:process.env.OPENAI_API_KEY});
 await require('../api/_lib/cover-letter-ai').generateLetter(input);await require('../api/_lib/career-kit').generateKit(input,review);
 assert.equal(calls.length,3);for(const body of calls){assert.equal(body.model,'gpt-5.4');assert.equal(body.store,false);assert.match(body.instructions,/complete military AND civilian background/);assert.match(body.instructions,/additional duties/i);assert.match(body.instructions,/Preserve each distinctly named system/);assert.match(body.instructions,/neutral Additional skills/);const data=JSON.parse(body.input);assert.equal(data.resume||data.submittedResume,input.resume);assert.equal(data.additionalDetails||data.verifiedDetails,input.additionalDetails);assert.equal(data.jobDescription||data.announcement,input.jobDescription);}
 assert.match(calls[1].instructions,/two or three concrete/);assert.match(calls[1].instructions,/job posting are not facts/);
});
