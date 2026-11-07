'use strict';
// A bounded factual safeguard, not a general semantic verifier. Keep this file
// identical to the local writer's lib/confirmed-facts.cjs. Applicant edits remain
// applicant assertions; job requirements, questions and service context do not.
const EVIDENCE_VERSION='confirmed-facts-1';
const clean=value=>String(value||'').normalize('NFKC').replace(/[\u2010-\u2015]/g,'-').replace(/[\u2018\u2019]/g,"'").replace(/\s+/g,' ').trim();
const action=/\b(?:drove|driving|driven|operat(?:ed|ing)|inspect(?:ed|ing)|perform(?:ed|ing)|dispatch(?:ed|ing)|train(?:ed)|record(?:ed|ing)|maintain(?:ed|ing)|coordinat(?:ed|ing)|schedul(?:ed|ing)|repair(?:ed|ing)|assist(?:ed|ing)|support(?:ed|ing)|manag(?:ed|ing)|supervis(?:ed|ing)|led|teach|taught|instruct(?:ed|ing)|prepar(?:ed|ing)|export(?:ed|ing)|develop(?:ed|ing)|implement(?:ed|ing)|configur(?:ed|ing)|wrote|built|creat(?:ed|ing)|complet(?:ed|ing)|earned|certified|licensed|design(?:ed|ing)|analys(?:ed|ing)|analyz(?:ed|ing)|administer(?:ed|ing))\b/i;
const context=/^(?:(?:u\.?s\.?|united states)\s+)?(?:army|navy|marine corps|marines|air force|space force|coast guard)\b|^(?:military rank|rank(?: history)?|pay grade|grade|mos|afsc|sfsc|rating(?:\s*\/\s*nec)?|nec|specialty code|full specialty code|skill level|service branch|branch|asi|sqi|additional qualification|special designator)\s*(?::|\||\b)|^(?:[EOW]-?\d{1,2}|SGT|SSG|SFC|MSG|CSM|CPL|PVT|SPC|Sgt|Sergeant|Corporal|Lieutenant|Captain|Major|Colonel|Admiral|General)\b|^\d{2}[A-Z](?:\d{1,2})?\b/i;
const question=/^(?:did|do|does|have|has|were|are|can|could|would|what|which|how|when|where)\s+(?:you|your)\b|\?\s*$/i;
const negative=/^(?:no\b|not\b|never\b|none\b)|\b(?:did|do|does|have|has|was|were|am|is|can)\s+not\b|\b(?:didn't|don't|haven't|never)\b/i;
const aspiration=/^(?:objective|target role|career goal|seeking|interested in|want to|planning to|requirements?)\s*[:\s]|\b(?:required|must have|will need|need to obtain|learning|pursuing)\b/i;
const statements=value=>String(value||'').split(/[\r\n]+|(?<=[.!?;])\s+(?=[A-Z•-])|,?\s+but\s+/u).map(s=>clean(s.replace(/^\s*[•*\-–]\s*/,''))).filter(Boolean);
function isConcreteEvidence(value,source=''){
 const text=clean(value).replace(/\(as recorded[^)]{0,60}\)/gi,'').trim();if(!text||question.test(text))return false;
 if(!action.test(text)&&/^[^\s@]+@[^\s@]+\.[^\s@]+(?:\s*[·|].*)?$|^https?:\/\//i.test(text))return false;
 const first=clean(String(source).split(/[\r\n]+/).find(line=>line.trim())||'');
 if(first&&text===first&&!action.test(text)&&!/\b(?:bachelor|master|degree|licen[sc]e|certification|certificate|diploma|PhD|programming)\b/i.test(text))return false;
 return !(context.test(text)&&!action.test(text));
}
function applicantFacts(source){
 const lines=String(source||'').split(/[\r\n]+/),unwrapped=[];
 for(const line of lines){const previous=unwrapped.at(-1)||'',next=line.trim();
  if(previous&&action.test(previous)&&!/[.!?;:]$/.test(previous)&&!context.test(next)&&!/^\s*[•*\-–]/.test(line)&&(/^[a-z]/.test(next)||/\b(?:in|on|with|from|to|for|and|the|a|an)\s*$/i.test(previous)&&!action.test(next)))unwrapped[unwrapped.length-1]=previous+' '+next;
  else unwrapped.push(line);
 }
 return statements(unwrapped.join('\n')).map(s=>s.replace(/^Applicant['’]s verified answer:\s*/i,'')).filter(s=>isConcreteEvidence(s)&&!question.test(s)&&!negative.test(s)&&!aspiration.test(s));
}
const reporting=/\b(?:prepar\w*|produc\w*|compil\w*|creat\w*|generat\w*|export\w*|deliver\w*|present\w*|analy[sz]\w*)\b[^.!?\n]{0,100}\b(?:reports?|reporting|dashboards?)\b|\b(?:weekly|daily|monthly|annual)\b[^.!?\n]{0,65}\b(?:reports?|reporting|dashboards?)\b/i;
const reportingAssistance=/\b(?:assist(?:ed|ing)?|support(?:ed|ing)?|help(?:ed|ing)?)\b[^.!?\n]{0,100}\b(?:reports?|reporting|dashboards?)\b/i;
const reportingEvidence=f=>reporting.test(f)&&!reportingAssistance.test(f)&&/\b(?:prepare(?:d|s)?|preparing|produce(?:d|s)?|produc(?:ed|ing)|compile(?:d|s)?|compiling|create(?:d|s)?|creating|generate(?:d|s)?|generating|export(?:ed|s|ing)?|deliver(?:ed|s|ing)?|present(?:ed|s|ing)?|analy[sz](?:ed|e|ing))\b/i.test(f)&&!/\b(?:to|how to)\s+(?:prepare|produce|compile|create|generate|export|deliver|present|analy[sz]e)\b|\b(?:reporting|reports?)\s+(?:course|training|class|certification|curriculum)\b/i.test(f);
const systems=[['gcss-army',/\bGCSS[- ]Army\b/i],['sap',/\bSAP\b/i],['netsuite',/\bNetSuite\b/i],['oracle',/\bOracle\b/i],['redprairie',/\b(?:Red\s*Prairie|Blue\s*Yonder|JDA)\b/i],['manhattan',/\bManhattan\b/i],['dynamics',/\b(?:Microsoft\s+)?Dynamics\b/i],['workday',/\bWorkday\b/i],['erp-wms',/\b(?:ERP|WMS|enterprise (?:software|systems?))\b/i]];
const implementation=/\b(?:implement(?:ed|ing|ation)?|deploy(?:ed|ing|ment)?|configur(?:ed|ing|ation)?|administer(?:ed|ing)?|integrat(?:ed|ing|ion)|programm(?:ed|ing)|coded|developed)\b/i;
const operationalProcess=/\bimplemented\s+(?:(?:a|an|the|new)\s+){0,3}(?:process|procedure|checklist|schedule|training|policy|plan|routine)\b/i;
const implementationEvidence=/\b(?:implemented|implements?|deployed|deploys?|configured|configures?|administered|administers?|integrated|integrates?|programmed|coded|developed)\b/i;
const instructionOnly=/\b(?:to|how to)\s+(?:implement|deploy|configure|administer|integrate|program|code|develop)\b/i;
const license=/\b(?:CDL|commercial driver['’]?s? licen[sc]e)\b/i;
const currentLicense=/\b(?:current|active|valid|hold|holds|have|possess|licensed)\b/i;
const inactiveLicense=/\b(?:expired|inactive|suspended|revoked|pending|in progress|studying|pursuing|learning)\b/i;
const management=/\b(?:managed|supervised)\s+(?:(?:a|the|all|assigned|civilian|military|other|\d+)\s+){0,3}(?:staff|people|teams?|drivers?|employees?|personnel)\b|\bled\s+(?:a\s+)?team\b/i;
const mentionsSystems=s=>systems.filter(([,pattern])=>pattern.test(s)).map(([key])=>key);
const bridge=/\b(?:could|may|potential|transferable|worth exploring|requires?|check|verify|confirm|would need|needs? training)\b/i;
function unsupportedFactualClaims(value,source,{allowBridges=false}={}){
 const facts=applicantFacts(source),problems=[];
 const add=(kind,claim)=>{if(!problems.some(p=>p.kind===kind&&p.claim===claim))problems.push({kind,claim:claim.slice(0,350)});};
 for(const clause of statements(value)){
  if(question.test(clause)||negative.test(clause)||allowBridges&&bridge.test(clause))continue;
  if(facts.some(f=>clean(f).toLowerCase().includes(clause.toLowerCase())))continue;
  if(reporting.test(clause)){
   const cadence=clause.match(/\b(?:weekly|daily|monthly|annual)\b/i)?.[0];
   if(!facts.some(f=>(reportingEvidence(f)||reportingAssistance.test(clause)&&reportingAssistance.test(f))&&(!cadence||new RegExp('\\b'+cadence+'\\b','i').test(f))))add('unconfirmed_reporting',clause);
  }
  if(implementation.test(clause)&&!operationalProcess.test(clause)){
   const named=mentionsSystems(clause);
   for(const key of named)if(!facts.some(f=>implementationEvidence.test(f)&&!instructionOnly.test(f)&&!operationalProcess.test(f)&&mentionsSystems(f).includes(key)))add('unconfirmed_system_implementation',clause);
  }
  if(license.test(clause)){
   const supplied=facts.filter(f=>license.test(f));
   if(!supplied.length||!supplied.some(f=>!inactiveLicense.test(f))&&!inactiveLicense.test(clause)||currentLicense.test(clause)&&!supplied.some(f=>currentLicense.test(f)&&!inactiveLicense.test(f)))add('unconfirmed_civilian_license',clause);
  }
  if(management.test(clause)&&!facts.some(f=>management.test(f)))add('unconfirmed_people_management',clause);
  if(problems.length>=16)break;
 }
 return problems;
}
function requirementClarification(requirement,evidence){
 const facts=applicantFacts(evidence),text=clean(requirement);
 if(/\b(?:weekly|daily|monthly|annual|prepar\w*|produc\w*|compil\w*|creat\w*|generat\w*|export\w*)\b[^.!?\n]{0,100}\b(?:reports?|reporting|dashboards?)\b/i.test(text)){
  const cadence=text.match(/\b(?:weekly|daily|monthly|annual)\b/i)?.[0];
  if(!facts.some(f=>reportingEvidence(f)&&(!cadence||new RegExp('\\b'+cadence+'\\b','i').test(f))))return 'Did you prepare or export reports? What did you track, and who used it?';
 }
 if(license.test(text)&&!facts.some(f=>license.test(f)&&!inactiveLicense.test(f)))return 'Do you hold the civilian license this posting requires? Confirm its type and current status; military driving does not establish a civilian license.';
 if(implementation.test(text)&&mentionsSystems(text).length&&unsupportedFactualClaims(text,evidence).length)return 'Did you implement or configure this system, or use it to complete your duties? Describe only the work you personally performed.';
 if(management.test(text)&&!facts.some(f=>management.test(f)))return 'Did you supervise people, deliver training, or assist a team? Describe your actual responsibility without inferring authority from rank.';
 if(!isConcreteEvidence(evidence))return 'Which duties or verified qualifications support this requirement? Your branch, rank and specialty code provide context only.';
 return '';
}
function careerEvidenceSupports(code,evidence,connection,source=''){
 if(!isConcreteEvidence(evidence,source))return false;
 if(['vcp-software-engineer','vcp-automation-workflow-developer','vcp-software-quality-tester'].includes(code)&&connection!=='Longer-term option')return /\b(?:programm\w*|cod(?:e|ed|ing)|debug\w*|JavaScript|TypeScript|Python|software (?:development|testing|engineering)|(?:developed|built|tested|designed|automated)\b[^.!?\n]{0,60}\b(?:software|applications?|websites?|APIs?|workflows?))\b/i.test(evidence);
 return true;
}
const factualWritingGuidance='Treat branch, rank, MOS/AFSC/rating and qualification codes as context, not proof of duties or civilian credentials. Using GCSS-Army or another ERP/WMS does not establish implementing, configuring or administering it. Recording vehicle status is not evidence of preparing or exporting reports. An unanswered question, a negative answer and a posting requirement are not confirmed applicant facts. Keep source duties and confirmed answers distinct; ask rather than adding reporting, licenses or management authority.';
module.exports={EVIDENCE_VERSION,isConcreteEvidence,applicantFacts,unsupportedFactualClaims,requirementClarification,careerEvidenceSupports,factualWritingGuidance};
