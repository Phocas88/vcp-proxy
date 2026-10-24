'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeKit,instructions}=require('../api/_lib/career-kit');
const input={resume:'ALEX EXAMPLE\nU.S. Navy\nSupply specialist\nMaintained equipment records and trained 3 colleagues.',additionalDetails:'Used spreadsheets for inventory.',jobDescription:'Maintain equipment records. Train colleagues.',role:'Supply planner'};
const kit={summary:'Evidence and gaps.',qualifications:[{requirement:'Maintain equipment records.',status:'Supported',evidence:'Maintained equipment records',nextAction:'Explain the inventory process.'}],translations:[{militaryTerm:'Supply specialist',civilianSkill:'Inventory records',evidence:'Maintained equipment records',resumeWording:'Maintained equipment records.',careerDirections:['Inventory coordinator']}],coverLetter:'Dear Hiring Team,\n\nI maintained equipment records and trained 3 colleagues.\n\nALEX EXAMPLE',checks:['Verify employer details.']};
test('career kit retains only quoted applicant evidence and actual announcement requirements',async()=>{
 const value=await normalizeKit({...kit,qualifications:[...kit.qualifications,{requirement:'Train colleagues.',status:'Supported',evidence:'Made up evidence',nextAction:'Add an example.'},{requirement:'Invented license',status:'Supported',evidence:'Maintained equipment records',nextAction:''}],translations:[...kit.translations,{...kit.translations[0],militaryTerm:'Invented specialty'},{...kit.translations[0],resumeWording:'Managed 500 staff.'}]},input);
 assert.equal(value.qualifications.length,2);assert.equal(value.qualifications[0].status,'Supported');assert.equal(value.qualifications[1].status,'Needs detail');assert.equal(value.qualifications[1].evidence,'');assert.equal(value.translations.length,1);
 assert.equal(value.coverLetter,kit.coverLetter);
});
test('unsupported metrics in a cover letter fail closed and no announcement produces no match claims',async()=>{
 await assert.rejects(()=>normalizeKit({...kit,coverLetter:'I managed 500 staff.'},input),/numeric facts/);
 const value=await normalizeKit(kit,{...input,role:'',jobDescription:''});assert.deepEqual(value.qualifications,[]);assert.equal(value.coverLetter,'');
 assert.match(instructions,/untrusted data/);assert.match(instructions,/specialty code alone/);
});
