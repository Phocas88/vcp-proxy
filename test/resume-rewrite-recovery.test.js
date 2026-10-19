'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const source='ALEX EXAMPLE\nSupply specialist, Example Employer\nMaintained 1,000 equipment records with 98 % documented accuracy. Trained colleagues and reconciled inventory discrepancies.';
const review={score:70,summary:'Use clearer duty statements.',strengths:[],findings:[],suggestions:[],nextSteps:[],rewriteNotes:[],revisedResume:source};
const mod=()=>import('../api/_lib/resume-workspace/review.mjs');

test('numeric checks allow thousands separators and percentage spacing without accepting new values or units',async()=>{
 const {normalizeReview}=await mod();
 const formatted=source.replace('1,000','1000').replace('98 %','98%');
 assert.equal(normalizeReview({...review,revisedResume:formatted},source).revisedResume,formatted);
 for(const proposal of [source+'\nImproved output by 99%.',source.replace('98 %','98K'),source.replace('1,000','10,000')]){
  assert.equal(normalizeReview({...review,revisedResume:proposal},source).revisedResume,'');
 }
 assert.equal(normalizeReview({...review,revisedResume:source.replace('1,000','1,00')},source).revisedResume,'');
 const amounts=source+'\nBudget: 1,000,000.50. Allocation: 1.1 M. Service: 2020–2024. Specialty: 25B.';
 const reformatted=amounts.replace('1,000,000.50','1000000.50').replace('1.1 M','1.1M');
 assert.equal(normalizeReview({...review,revisedResume:reformatted},amounts).revisedResume,reformatted);
 assert.equal(normalizeReview({...review,revisedResume:amounts.replace('2024','2025')},amounts).revisedResume,'');
});

test('a rejected rewrite gets one constrained correction request using the same original facts',async()=>{
 const {reviewWithRecovery}=await mod();const calls=[];
 const result=await reviewWithRecovery({resume:source},async(input,options)=>{
  calls.push({input,options});
  return {...review,revisedResume:calls.length===1?source+'\nImproved output by 99%.':source.replace('Maintained','Reconciled')};
 });
 assert.equal(calls.length,2);assert.equal(calls[0].input.resume,source);assert.deepEqual(calls[1].input,calls[0].input);
 assert.match(calls[1].options.instructions,/previous draft failed/);assert.match(calls[1].options.instructions,/unsupportedNumbers/);assert.match(calls[1].options.instructions,/99%/);
 assert.equal(calls[0].options.signal,calls[1].options.signal);assert.equal(result.revisedResume,source.replace('Maintained','Reconciled'));
});

test('empty and overlong rewrites can recover but repeated rejection never returns an unchecked draft',async()=>{
 const {reviewWithRecovery,MAX_RESUME_LENGTH}=await mod();
 for(const first of ['',source+'x'.repeat(MAX_RESUME_LENGTH)]){
  let calls=0;assert.equal((await reviewWithRecovery({resume:source},async()=>({...review,revisedResume:++calls===1?first:source}))).revisedResume,source);assert.equal(calls,2);
 }
 let calls=0;await assert.rejects(reviewWithRecovery({resume:source},async()=>{calls++;return {...review,revisedResume:source+'\nInvented 77% improvement.'};}),e=>e.diagnosticCode==='AI_REWRITE_WITHHELD');assert.equal(calls,2);
});

test('authentication failures, malformed reviews and cancellation are not retried as rewrite repairs',async()=>{
 const {reviewWithRecovery,ReviewError}=await mod();
 for(const response of [()=>{throw new ReviewError('Unavailable',502,'AI_AUTHENTICATION');},()=>({})]){
  let calls=0;await assert.rejects(reviewWithRecovery({resume:source},async()=>{calls++;return response();}));assert.equal(calls,1);
 }
 let calls=0;const c=new AbortController();c.abort();await assert.rejects(reviewWithRecovery({resume:source},async()=>{calls++;return review;},{signal:c.signal}));assert.equal(calls,0);
});

test('an expired shared deadline stops correction before another provider request',async()=>{
 const {reviewWithRecovery}=await mod();const c=new AbortController();let calls=0;
 await assert.rejects(reviewWithRecovery({resume:source},async()=>{calls++;c.abort();return {...review,revisedResume:''};},{signal:c.signal}),e=>e.diagnosticCode==='AI_TIMEOUT');
 assert.equal(calls,1);
});
