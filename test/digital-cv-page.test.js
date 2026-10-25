'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {renderDigitalCv,date}=require('../api/_lib/digital-cv-page');
const fixture=require('../scripts/fixtures/public-cv.cjs');
const handler=require('../api/veteran/[slug]');
const slug='vcp-resume-fictional-example';
test('a complete digital CV presents all published facts and professional section hierarchy',()=>{
 const html=renderDigitalCv(fixture,slug);
 for(const fact of [fixture.name,fixture.headline,fixture.summary,'Example Logistics Group','Inventory Specialist','Example Support Unit','Example State University','Business Administration','Inventory management','Workplace Safety Training'])assert.ok(html.includes(fact.replaceAll('&','&amp;')),fact);
 assert.match(html,/data-cv-layout="professional-20261025"/);assert.match(html,/<h1 class="cv-name">Alex Morgan<\/h1>/);assert.match(html,/Jan 2022 – Present/);assert.match(html,/Jun 2014 – Mar 2019/);assert.match(html,/aria-label="Jump to section"/);
 assert.doesNotMatch(html,/class="hero"|class="emblem"|Bebas Neue|fonts.googleapis|<script|\/app.html|🎖️|army.webp/);assert.match(html,/noindex,nofollow/);
});
test('civilian-only and minimal CVs never gain veteran claims, empty cards or unselected contact details',()=>{
 const html=renderDigitalCv({source:fixture.source,name:'Example Civilian',civilian:fixture.civilian,contact:{}},slug);
 assert.doesNotMatch(html,/U.S. Military Veteran|Military service<\/h2>|mailto:|tel:|cv-contact"/);assert.match(html,/Professional experience/);assert.match(html,/cv-body cv-single/);
 const empty=renderDigitalCv({name:'Example Applicant'},slug);assert.doesNotMatch(empty,/class="cv-body|class="cv-section"|class="cv-jump"/);assert.match(empty,/Example Applicant/);assert.doesNotMatch(empty,/unemployed|veteran career profile/i);
});
test('profile text is escaped, unsafe links are rejected and only the allowlisted public fields render',()=>{
 const html=renderDigitalCv({...fixture,name:'<img src=x onerror=alert(1)>',summary:'<script>alert(2)</script>',contact:{linkedin:'javascript:alert(3)',phone:'555-0100" onclick="alert(4)',email:'example@example.com" onmouseover="alert(5)'},uid:'PRIVATE_OWNER',ssn:'PRIVATE_SSN',medical:'PRIVATE_MEDICAL',military:[{...fixture.military[0],clearance:'PRIVATE_CLEARANCE',bullets:['<svg onload=alert(6)>']}],photo:'https://example.com/private-tracking-image.jpg'},slug);
 assert.match(html,/&lt;script&gt;alert\(2\)&lt;\/script&gt;/);assert.doesNotMatch(html,/<script|<img|href="javascript:|onmouseover="|onclick="|PRIVATE_OWNER|PRIVATE_SSN|PRIVATE_MEDICAL|PRIVATE_CLEARANCE|private-tracking-image/);
 assert.match(html,/mailto:example%40example.com/);assert.equal(date('2020'),'2020');assert.equal(date('2020-12'),'Dec 2020');assert.equal(date('unconfirmed'),'unconfirmed');
});
function encode(value){if(value===null)return {nullValue:null};if(typeof value==='string')return {stringValue:value};if(typeof value==='boolean')return {booleanValue:value};if(Array.isArray(value))return {arrayValue:{values:value.map(encode)}};return {mapValue:{fields:Object.fromEntries(Object.entries(value).map(([key,v])=>[key,encode(v)]))}};}
async function request(profile,status=200){const previous=global.fetch;global.fetch=async()=>({ok:status===200,status,json:async()=>({fields:encode(profile).mapValue.fields})});const headers={};const res={setHeader(key,value){headers[key]=value;},status(value){this.code=value;return this;},send(value){this.body=value;return this;}};try{await handler({query:{slug},headers:{host:'profiles.veterancareerpath.com'}},res);return {...res,headers};}finally{global.fetch=previous;}}
test('the live route uses the new design for app CVs while preserving legacy website profiles and unpublished behavior',async()=>{
 const app=await request(fixture);assert.equal(app.code,200);assert.match(app.body,/data-cv-layout="professional-20261025"/);assert.match(app.headers['Cache-Control'],/s-maxage=60/);
 const legacy=await request({...fixture,source:'legacy-website'});assert.equal(legacy.code,200);assert.match(legacy.body,/class="hero"/);assert.doesNotMatch(legacy.body,/data-cv-layout/);
 assert.equal((await request({...fixture,published:false})).code,404);assert.equal((await request({},404)).code,404);
});
