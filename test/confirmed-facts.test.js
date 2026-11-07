'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {isConcreteEvidence,unsupportedFactualClaims,requirementClarification,careerEvidenceSupports}=require('../api/_lib/confirmed-facts');
const a='APPLICANT A\nArmy | MOS 88M\nDrove convoy vehicles.\nPerformed vehicle inspections before and after missions.';
const b='APPLICANT B\nArmy | MOS 88M\nDispatched vehicles.\nTrained drivers.\nRecorded vehicle status in GCSS-Army.';
const question='Did you prepare or export reports? What did you track, and who used it?';
const answer='I exported vehicle-status data from GCSS-Army and prepared a weekly availability report for the dispatch team.';
const kinds=(value,source)=>unsupportedFactualClaims(value,source).map(p=>p.kind);
test('branch, rank and unknown or legacy codes provide context without inventing duties',()=>{
 for(const value of ['Army | MOS 88M','MOS: 88M02','Military rank: SGT','Pay grade: E-5','AFSC: 3D1X2','Rating / NEC: UNKNOWN','SQI: X','Full specialty code (as recorded): 88M02','Skill level: 2'])assert.equal(isConcreteEvidence(value),false,value);
 for(const value of ['Dispatched vehicles.','Additional duty: Trained drivers.','MOS: 88M · Drove convoy vehicles.','Completed a bachelor degree.'])assert.equal(isConcreteEvidence(value),true,value);
 assert.equal(careerEvidenceSupports('vcp-software-engineer','Army | MOS 88M','Experience connection',b),false);
 assert.equal(careerEvidenceSupports('vcp-office-support-coordinator','APPLICANT B','Experience connection',b),false);
 assert.equal(isConcreteEvidence('applicant@example.com'),false);
});
test('each applicant retains only their own duties as evidence',()=>{
 assert.deepEqual(unsupportedFactualClaims(a,a),[]);assert.deepEqual(unsupportedFactualClaims(b,b),[]);
 assert.equal(careerEvidenceSupports('vcp-freight-truck-driver','Drove convoy vehicles.','Experience connection',a),true);
 assert.equal(careerEvidenceSupports('vcp-fleet-operations-coordinator','Recorded vehicle status in GCSS-Army.','Experience connection',b),true);
});
test('GCSS-Army use establishes neither software engineering nor implementation',()=>{
 assert.deepEqual(kinds('Implemented GCSS-Army.',b),['unconfirmed_system_implementation']);
 assert.equal(careerEvidenceSupports('vcp-software-engineer','Recorded vehicle status in GCSS-Army.','Experience connection',b),false);
 assert.equal(careerEvidenceSupports('vcp-software-engineer','Developed and tested software applications.','Experience connection',b),true);
 assert.deepEqual(unsupportedFactualClaims('Implemented GCSS-Army.','Implemented GCSS-Army.'),[]);
 assert.deepEqual(kinds('Configured GCSS-Army.','Configured SAP.\nRecorded vehicle status in GCSS-Army.'),['unconfirmed_system_implementation']);
 assert.deepEqual(unsupportedFactualClaims('Implemented a checklist for recording vehicle status in GCSS-Army.','Implemented a checklist for recording vehicle status in GCSS-Army.'),[]);
});
test('courses and training do not prove that the applicant implemented a system or prepared reports',()=>{
 for(const source of ['Completed a SAP implementation course.','Trained to implement SAP.'])assert.ok(kinds('Implemented SAP.',source).includes('unconfirmed_system_implementation'));
 assert.ok(kinds('Prepared weekly reports.','Completed weekly reporting training.').includes('unconfirmed_reporting'));
});
test('recording status does not establish weekly reporting, and the missing fact becomes a question',()=>{
 assert.deepEqual(kinds('Prepared weekly vehicle availability reports.',b),['unconfirmed_reporting']);
 assert.equal(requirementClarification('Prepare weekly vehicle availability reports.','Recorded vehicle status in GCSS-Army.'),question);
 assert.equal(requirementClarification('Prepare weekly vehicle availability reports.','Performed vehicle inspections.'),question);
});
test('unanswered questions and negative answers never authorize reporting claims',()=>{
 for(const detail of ['',question,question+'\nApplicant’s verified answer: No, I did not prepare reports.'])assert.ok(kinds('Prepared weekly vehicle availability reports.',b+'\n'+detail).includes('unconfirmed_reporting'));
});
test('an affirmative answer authorizes only the confirmed reporting work',()=>{
 const source=b+'\n'+question+'\nApplicant’s verified answer: '+answer;
 assert.deepEqual(unsupportedFactualClaims('Prepared a weekly vehicle availability report for the dispatch team.',source),[]);
 assert.equal(requirementClarification('Prepare weekly vehicle availability reports.',answer),'');
 assert.ok(kinds('Prepared daily vehicle availability reports.',source).includes('unconfirmed_reporting'));
 assert.ok(kinds('Implemented GCSS-Army.',source).includes('unconfirmed_system_implementation'));
 assert.deepEqual(unsupportedFactualClaims(answer,source),[]);
});
test('general reporting experience does not establish an unconfirmed reporting cadence',()=>{
 assert.ok(kinds('Prepared weekly reports.','Prepared vehicle availability reports.').includes('unconfirmed_reporting'));
 assert.deepEqual(unsupportedFactualClaims('Prepared reports.','Prepared weekly vehicle availability reports.'),[]);
});
test('grammar repairs preserve reporting assistance without promoting it to report preparation',()=>{
 const output='Maintained records and assisted the team with monthly reporting.';
 for(const source of ['Maintained records and was assisting the team with monthly reporting.','Maintained records and\nwas assisting the team with\nmonthly reporting.']){
  assert.deepEqual(unsupportedFactualClaims(output,source),[]);
  assert.ok(kinds('Prepared monthly reports.',source).includes('unconfirmed_reporting'));
 }
 assert.ok(kinds('Configured GCSS-Army.','Recorded vehicle status in GCSS-Army\nConfigured SAP.').includes('unconfirmed_system_implementation'));
});
test('military driving and expired civilian licenses do not establish a current CDL',()=>{
 for(const source of [a,b,'Earned a CDL.','CDL expired.'])assert.ok(kinds('I hold a current CDL.',source).includes('unconfirmed_civilian_license'),source);
 assert.ok(kinds('Commercial driver license.','CDL expired.').includes('unconfirmed_civilian_license'));
 assert.deepEqual(unsupportedFactualClaims('Current CDL.','I hold a current CDL.'),[]);
 assert.deepEqual(unsupportedFactualClaims('CDL expired.','CDL expired.'),[]);
 assert.ok(requirementClarification('Current civilian CDL required.','Army | MOS 88M').includes('civilian license'));
});
test('driver training and rank do not imply people-management authority',()=>{
 assert.deepEqual(kinds('Managed drivers.',b),['unconfirmed_people_management']);
 assert.deepEqual(unsupportedFactualClaims('Supervised drivers.','Supervised drivers.'),[]);
 assert.deepEqual(unsupportedFactualClaims('Trained drivers.',b),[]);
});
test('clearly labeled preparation advice is separate from factual career claims',()=>{
 assert.deepEqual(unsupportedFactualClaims('Check civilian CDL requirements.',b,{allowBridges:true}),[]);
 assert.ok(kinds('I hold a current CDL.',b).length);
});
