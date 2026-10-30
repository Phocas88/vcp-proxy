'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {renderDigitalCv,date}=require('../api/_lib/digital-cv-page');
const fixture=require('../scripts/fixtures/public-cv.cjs');
const handler=require('../api/veteran/[slug]');
const slug='vcp-resume-fictional-example';
test('a complete digital CV presents all published facts and professional section hierarchy',()=>{
 const html=renderDigitalCv(fixture,slug);
 for(const fact of [fixture.name,fixture.headline,fixture.summary,'Example Logistics Group','Inventory Specialist','Example Support Unit','Example State University','Business Administration','Inventory management','Workplace Safety Training'])assert.ok(html.includes(fact.replaceAll('&','&amp;')),fact);
 assert.match(html,/data-cv-layout="desktop-20261030-sections"/);assert.match(html,/<h1 class="cv-name">Alex Morgan<\/h1>/);assert.match(html,/Jan 2022 – Present/);assert.match(html,/Jun 2014 – Mar 2019/);assert.match(html,/aria-label="Jump to section"/);
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
 const app=await request(fixture);assert.equal(app.code,200);assert.match(app.body,/data-cv-layout="desktop-20261030-sections"/);assert.match(app.headers['Cache-Control'],/s-maxage=60/);
 const legacy=await request({...fixture,source:'legacy-website'});assert.equal(legacy.code,200);assert.match(legacy.body,/class="hero"/);assert.doesNotMatch(legacy.body,/data-cv-layout/);
 assert.equal((await request({...fixture,published:false})).code,404);assert.equal((await request({},404)).code,404);
});

test('optional profile photo and professional links are rendered safely without executable URLs',()=>{
 const {renderDigitalCv,safePhoto}=require('../api/_lib/digital-cv-page');const photo='data:image/jpeg;base64,/9j/4P/Z';assert.equal(safePhoto(photo),photo);const html=renderDigitalCv({name:'EXAMPLE PROFILE',photo,contact:{github:'https://github.com/example',portfolio:'https://example.com/work',website:'javascript:alert(1)'}},'example');assert.ok(html.includes('src="'+photo+'"'));assert.ok(html.includes('https://github.com/example'));assert.ok(html.includes('https://example.com/work'));assert.ok(!html.includes('javascript:'));assert.equal(safePhoto('data:image/svg+xml;base64,PHN2Zz4='),'');assert.equal(safePhoto('https://example.com/photo.jpg'),'');assert.equal(safePhoto('data:image/jpeg;base64,/9j/YmFk'),'');
});

test('mobile CVs retain the desktop viewport, columns and readable zoom controls',()=>{
 const html=renderDigitalCv(fixture,slug);assert.match(html,/<meta name="viewport" content="width=1180">/);assert.match(html,/body\{min-width:1180px/);assert.match(html,/\.cv-body\{display:grid;grid-template-columns:/);assert.doesNotMatch(html,/@media\(max-width:(900|540)px\)|user-scalable=no|maximum-scale=1/);assert.match(html,/@media print\{[\s\S]*?body\{[^}]*min-width:0/);
});

test('existing public CVs recover misfiled skills and education from public summary text without reading or publishing private data',()=>{
 const original={name:'Alex Morgan',summary:'Operations professional with\nverified training experience.\n\nTECHNICAL AND BUSINESS SKILLS\nExcel, SQL, Power BI\nMorgan 3/4\nEDUCATION\nBachelor of Science | Example University | 2022',civilian:[{title:'Coordinator',bullets:['Maintained accurate records.','Morgan 4/4']}],skills:{},education:[]};const before=structuredClone(original),html=renderDigitalCv(original,slug);assert.match(html,/id="skills"/);assert.match(html,/id="education"/);assert.match(html,/Example University/);assert.match(html,/Operations professional with verified training experience\./);assert.doesNotMatch(html,/Morgan [34]\/4/);assert.doesNotMatch(html,/<div class="cv-summary">[\s\S]*?TECHNICAL AND BUSINESS SKILLS[\s\S]*?<\/div>/);assert.deepEqual(original,before);
});

test('education and skills accidentally appended to a public job are restored as sections; malformed entries remain safe',()=>{
 const cv={name:'Alex Morgan',civilian:[null,{title:'Coordinator',bullets:['Maintained schedules.','TECHNICAL AND BUSINESS SKILLS','Excel, Training','EDUCATION','Bachelor of Science | Example University | 2022',null]}],education:[],skills:{},training:[{name:'Example safety course',institution:'Example Academy'}],projects:[{name:'Example community project',bullets:['Organized verified deliveries.']}]};const html=renderDigitalCv(cv,slug);assert.match(html,/id="skills"/);assert.match(html,/id="education"/);assert.match(html,/Example safety course/);assert.match(html,/Example community project/);assert.match(html,/Maintained schedules/);assert.doesNotMatch(html,/<li>TECHNICAL AND BUSINESS SKILLS<\/li>/);
});

test('already-published education blobs and skill category labels become independent readable sections',()=>{
 const input={source:'vcp-resume-program',name:'Alex Morgan',summary:'Verified professional summary.\nEDUCATION\nExample State University Bachelor of Science in Data Analytics, expected June 2027 Credentials: Lean Six Sigma Green Belt; Warehouse Certificate (ASCM/APICS); Inventory system training; Learn SQL Course',civilian:[{title:'Software developer',employer:'Example Employer',startDate:'2019-04',endDate:'2020-06',bullets:['Maintained verified records.','Built workflows using','APIs and relational databases.','Jun 2020']}],skills:{technical:'Software & Development: JavaScript, Node.js, HTML, CSS, SQL, Analytics & Automation: Tableau, Excel, Enterprise Platforms: NetSuite, GCSS-Army, Operations: Inventory control, Supply chain planning',languages:'English, Spanish — conversational'},projects:[{name:'Example community project',title:'Volunteer coordinator',startDate:'2022-01',endDate:'2022-12',bullets:['Organized verified deliveries.']}]},copy=structuredClone(input),html=renderDigitalCv(input,slug);
 const section=id=>html.slice(html.indexOf('<section class="cv-section" aria-labelledby="'+id+'">'),html.indexOf('</section>',html.indexOf('<section class="cv-section" aria-labelledby="'+id+'">')));
 const education=section('education');for(const fact of ['Example State University','Bachelor of Science','Data Analytics','Expected June 2027'])assert.ok(education.includes(fact));assert.doesNotMatch(education,/Green Belt|Certificate|training|SQL Course/);
 const skills=section('skills');for(const label of ['Software &amp; Development','Analytics &amp; Automation','Enterprise Platforms','Operations'])assert.ok(skills.includes('>'+label+'</h3>'));assert.match(skills,/<li>JavaScript<\/li>/);assert.doesNotMatch(skills,/<li>[^<]*Development:|class="cv-tags"/);
 assert.match(section('certifications'),/Warehouse Certificate \(ASCM\/APICS\)/);assert.doesNotMatch(section('certifications'),/system training|SQL Course/);assert.match(section('training'),/Inventory system training/);assert.match(section('training'),/Learn SQL Course/);assert.match(section('languages'),/Spanish — conversational/);assert.match(section('projects'),/Jan 2022 – Dec 2022/);
 assert.match(section('experience'),/<li>Built workflows using APIs and relational databases\.<\/li>/);assert.doesNotMatch(section('experience'),/<li>Jun 2020<\/li>/);
 for(const id of ['experience','skills','education','certifications','training','projects','languages'])assert.ok(html.includes('href="#'+id+'"'));assert.doesNotMatch(html,/class="cv-support"|class="cv-primary"/);assert.deepEqual(input,copy);
});
test('organization is repeatable, preserves issuer commas and date facts, and does not infer completed credentials',()=>{
 const {cleanPublicCv,cvSkillGroups,cvCredentialEntries,cvListItems}=require('../api/_lib/cv-content');
 const input={name:'Alex Morgan',education:[{institution:'Example University',degree:'Bachelor of Science · In progress',field:'Business',year:'Expected 2027'}],skills:{technical:'Tools & Technologies: Microsoft (Azure, Dynamics), Excel, Operations: Budget planning for $1,000',certs:'Example certificate — Example University, Global Campus'},summary:'Verified summary.',training:[{name:'Example course',institution:'Example School',date:'2024',status:'In progress'}]};
 const organized=cleanPublicCv(input);assert.deepEqual(cleanPublicCv(organized),organized);assert.equal(organized.education[0].degree,'Bachelor of Science');assert.equal(organized.education[0].status,'In progress');assert.equal(organized.education[0].year,'Expected 2027');assert.equal(cvCredentialEntries(organized.skills.certs).length,1);assert.match(organized.skills.certs,/Example University, Global Campus/);assert.deepEqual(cvSkillGroups(organized.skills.technical)[0].items,['Microsoft (Azure, Dynamics)','Excel']);assert.deepEqual(cvListItems('Budget planning for $1,000'),['Budget planning for $1,000']);assert.doesNotMatch(renderDigitalCv(organized,slug),/>Completed<|graduated|Active credential/);
});

test('plain Credentials headings in existing education notes create a separate certification section',()=>{
 for(const heading of ['Credentials ','Credentials\n','CREDENTIALS\n','Certifications — ','Certifications - ','CERTIFICATIONS\n']){
  const label=heading;
  const input={name:'Alex Example',education:[{institution:'Example University',degree:'Bachelor of Science',field:'Data Analytics',year:'Expected June 2027',details:label+'Lean Six Sigma Green Belt; Warehousing Certificate (Example Institute); SAP /\nInventory system training; Learn SQL Course'}],skills:{}};
  const original=structuredClone(input),html=renderDigitalCv(input,slug),section=id=>html.slice(html.indexOf('<section class="cv-section" aria-labelledby="'+id+'">'),html.indexOf('</section>',html.indexOf('<section class="cv-section" aria-labelledby="'+id+'">')));
  assert.ok(section('certifications').includes('Lean Six Sigma Green Belt'));assert.ok(section('certifications').includes('Warehousing Certificate (Example Institute)'));assert.doesNotMatch(section('education'),/Credentials|CREDENTIALS|Green Belt|Warehousing|Inventory system|SQL Course/);assert.match(section('education'),/Bachelor of Science/);assert.match(section('education'),/Expected June 2027/);assert.match(section('training'),/SAP \/ Inventory system training/);assert.match(section('training'),/Learn SQL Course/);assert.doesNotMatch(section('certifications'),/<h3>SAP \/<\/h3>/);assert.ok(html.includes('href="#certifications"'));assert.deepEqual(input,original);
 }
});
test('credential words inside academic names are preserved and normalization stays repeatable',()=>{
 const {cleanPublicCv}=require('../api/_lib/cv-content');const value={name:'Alex Example',education:[{institution:'Example University',degree:'Graduate Certificate: Digital Credentials Management',field:'Credentials Management',year:'2024',details:'Graduate coursework in credentials management.'}],skills:{}};
 const output=cleanPublicCv(value);assert.equal(output.education[0].degree,value.education[0].degree);assert.equal(output.education[0].field,value.education[0].field);assert.equal(output.education[0].details,value.education[0].details);assert.equal(output.skills.certs,'');assert.deepEqual(cleanPublicCv(output),output);
});
