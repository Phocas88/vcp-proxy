'use strict';
const {cleanResumeText,splitResumeSections,flowParagraphs,resumeHeading}=require('./resume-text');
// Presentation repairs use only the selected/public snapshot. Never fetch or
// infer qualifications from a private profile, military code, or job posting.
const cvText=value=>typeof value==='string'?value.trim():'';
const cvRows=value=>(Array.isArray(value)?value:[]).filter(row=>row&&typeof row==='object'&&!Array.isArray(row));
const cvUnique=values=>{const seen=new Set();return values.filter(value=>{const key=typeof value==='string'?value.replace(/\s+/g,' ').toLocaleLowerCase():JSON.stringify(value);if(!key||seen.has(key))return false;seen.add(key);return true;});};
function cvListItems(value){
 const output=[];let part='',depth=0;const characters=[...cvText(value)];
 for(const [index,char]of characters.entries()){if(char==='('||char==='[')depth++;if(char===')'||char===']')depth=Math.max(0,depth-1);if(!depth&&/[,;\n|•]/.test(char)&&!(char===','&&/\d/.test(characters[index-1]||'')&&/\d/.test(characters[index+1]||''))){const item=part.trim().replace(/^[▪◦*\-]\s+/,'');if(item)output.push(item);part='';}else part+=char;}
 if(part.trim())output.push(part.trim().replace(/^[▪◦*\-]\s+/,''));
 // A year or corporate suffix belongs to the preceding item, not a new card.
 const joined=[];for(const item of output){if(joined.length&&/^(?:(?:19|20)\d{2}|Inc\.?|LLC|Ltd\.?|USA|U\.S\.A\.)$/i.test(item))joined[joined.length-1]+=', '+item;else joined.push(item);}return cvUnique(joined);
}
function cvCredentialEntries(value){
 const source=cvText(value);if(!source)return [];
 // New snapshots use one credential per line, keeping issuer commas intact.
 let entries=/\n|;/.test(source)?source.split(/\n|;/).map(cvText).filter(Boolean):cvListItems(source);
 if(!/\n|;/.test(source)&&/\s[—–]\s/.test(source)){const merged=[];for(const entry of entries){if(merged.length&&!/\s[—–]\s|\b(?:certificate|certification|certified|license|PMP|CISSP|CompTIA)\b/i.test(entry))merged[merged.length-1]+=', '+entry;else merged.push(entry);}entries=merged;}
 return cvUnique(entries).map(item=>{const parts=item.replace(/^(?:credentials?|certifications?|licenses?)\s*:\s*/i,'').split(/\s+[—–]\s+/).map(cvText);return {name:parts[0],details:parts.slice(1).join(' · ')};}).filter(e=>e.name);
}
function cvTrainingEntries(value){
 const result=[];
 for(const line of cvText(value).split(/\n|;/).map(cvText).filter(Boolean)){
  if(!/[|·]|\s[—–]\s/.test(line)){for(const name of cvListItems(line))result.push({name,institution:'',date:'',status:''});continue;}
  const parts=line.split(/\s*[|·]\s*|\s+[—–]\s+/).map(cvText).filter(Boolean),name=parts.shift(),status=parts.find(v=>/^(?:completed|in progress|not completed|incomplete|pending|active|expired|inactive)$/i.test(v))||'',date=parts.find(v=>/^(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+)?(?:19|20)\d{2}(?:-\d{2})?$/i.test(v))||'';
  result.push({name,institution:parts.filter(v=>v!==status&&v!==date).join(' · '),date,status});
 }
 return result;
}
function cvSkillGroups(technical='',leadership=''){
 const groups=[],known='Software(?:\\s*(?:&|and)\\s*Development|\\s+Development)|(?:Data\\s*(?:&|and)\\s*)?(?:Analytics?|Analysis)(?:\\s*(?:&|and)\\s*Automation)?|Enterprise\\s+(?:Platforms?|Systems?)|Operations(?:\\s*(?:&|and)\\s*(?:Logistics|Supply\\s+Chain|Business))?|Technical(?:\\s*(?:&|and)\\s*Business)?\\s+Skills|Core\\s+Skills|Leadership(?:\\s+Skills)?|Tools\\s*(?:&|and)\\s*Technologies|Business\\s+Skills|Professional\\s+Skills|Additional\\s+Skills';
 const label=new RegExp('(?:\\b('+known+')|(?:^|[\\n;])\\s*([^:\\n;,]{2,70}))\\s*:\\s*','gi');
 function add(title,body){const items=cvListItems(body);if(!items.length)return;const old=groups.find(group=>group.title.toLocaleLowerCase()===title.toLocaleLowerCase());if(old)old.items=cvUnique([...old.items,...items]);else groups.push({title,items});}
 for(const [source,fallback]of [[cvText(technical),'Core skills'],[cvText(leadership),'Leadership skills']]){
  let cursor=0,title=fallback;for(const match of source.matchAll(label)){add(title,source.slice(cursor,match.index));title=(match[1]||match[2]).trim();cursor=match.index+match[0].length;}add(title,source.slice(cursor));
 }
 return groups;
}
function recoverCvSections(value={}){
 const name=cvText(value.name),sections=splitResumeSections(value.summary||'',{initial:'summary',name});
 const keys=new Set(['skillsEntries','educationEntries','certifications','training','languages','projects']);
 const collect=(key,text)=>{if(text.trim())sections[key]+=(sections[key]?'\n':'')+text;};
 const cleanRows=rows=>cvRows(rows).map(row=>{
  let target=null;const bullets=[];
  for(const raw of (Array.isArray(row.bullets)?row.bullets:[]).filter(v=>typeof v==='string')){
   const kept=[];for(const line of cleanResumeText(raw,name).split('\n')){const heading=resumeHeading(line);if(heading&&keys.has(heading.key)){target=heading.key;if(heading.rest)collect(target,heading.rest);}else if(heading){target=null;kept.push(line);}else if(target)collect(target,line);else kept.push(line);}
   const text=flowParagraphs(kept.join('\n'));if(!text)continue;
   const monthDate=/^(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+)?(?:19|20)\d{2}$/i;
   const dateKey=v=>{const m=cvText(v).match(/^(\d{4})-(\d{2})$/);return m?['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m[2]-1]+' '+m[1]:cvText(v);};
   if(monthDate.test(text)&&[dateKey(row.startDate),dateKey(row.endDate),cvText(row.dateText)].some(v=>v.toLocaleLowerCase().includes(text.toLocaleLowerCase())))continue;
   const prior=bullets.at(-1);if(prior&&!/[.!?]$/.test(prior)&&(/\b(?:and|or|using|with|including|through|for|to|of|across|within)\s*$/i.test(prior)||/^(?:and|or|using|including|through|within|flow\b)\s*/.test(text)))bullets[bullets.length-1]+=' '+text;else bullets.push(text);
  }
  return {...row,title:typeof row.title==='string'?cleanResumeText(row.title,name):row.title,bullets};
 });
 const civilian=cleanRows(value.civilian),military=cleanRows(value.military);
 const skills=typeof value.skills==='string'?{technical:value.skills}:{...(value.skills&&typeof value.skills==='object'?value.skills:{})};
 for(const [source,key]of [['skillsEntries','technical'],['certifications','certs'],['languages','languages']])skills[key]=cvUnique([cleanResumeText(cvText(skills[key]),name),sections[source].trim()].filter(Boolean)).join('\n');
 return {...value,summary:flowParagraphs(sections.summary),skills,civilian,military,publicEducation:cvUnique([cvText(value.publicEducation),sections.educationEntries.trim()].filter(Boolean)).join('\n'),publicTraining:cvUnique([cvText(value.publicTraining),sections.training.trim()].filter(Boolean)).join('\n'),publicProjects:cvUnique([cvText(value.publicProjects),sections.projects.trim()].filter(Boolean)).join('\n')};
}
const degreePattern=/\b(?:bachelor(?:['’]s)?(?:\s+of\s+(?:science|arts|business|applied\s+science))?|master(?:['’]s)?(?:\s+of\s+(?:science|arts|business\s+administration))?|associate(?:['’]s)?(?:\s+of\s+(?:science|arts|applied\s+science))?|doctor(?:ate)?|Ph\.?D\.?|B\.?S\.?|B\.?A\.?|M\.?S\.?|M\.?B\.?A\.?)\b/i;
function cleanPublicCv(value={}){
 const p=recoverCvSections(value),certs=[cvText(p.skills.certs)],training=cvRows(p.training).map(e=>({name:cvText(e.name),institution:cvText(e.institution),date:cvText(e.date),status:cvText(e.status)})).filter(e=>e.name),education=[];
 function extract(text){
  const pattern=/\b(Credentials?|Certifications?|Certificates?|Licenses?(?:\s*(?:&|and)\s*Certifications?)?|Training|Courses?)\s*:\s*/gi;let main=text,cursor=0,target=null;
  for(const match of text.matchAll(pattern)){if(/^certificates?$/i.test(match[1])&&/\b(?:graduate|postgraduate|undergraduate|academic)\s+$/i.test(text.slice(0,match.index)))continue;if(target){const content=text.slice(cursor,match.index);if(target==='training')training.push(...cvTrainingEntries(content));else certs.push(content);}else main=text.slice(0,match.index);target=/training|courses?/i.test(match[1])?'training':'certs';cursor=match.index+match[0].length;}
  if(target){const content=text.slice(cursor);if(target==='training')training.push(...cvTrainingEntries(content));else for(const item of cvListItems(content)){if(/\b(?:training|course)\b/i.test(item))training.push({name:item,institution:'',date:'',status:''});else certs.push(item);}}
  return main.trim().replace(/[,;|·\s]+$/,'');
 }
 function record(entry){
  let institution=extract(cvText(entry.institution)),degree=extract(cvText(entry.degree)),field=extract(cvText(entry.field)),year=extract(cvText(entry.year)),status=cvText(entry.status),details=extract(cvText(entry.details));
  // Recover a degree embedded after the institution without guessing a school.
  const embedded=institution.match(degreePattern);if(embedded&&embedded.index>0&&!degree){degree=institution.slice(embedded.index);institution=institution.slice(0,embedded.index).replace(/[,;|·\s]+$/,'');}
  const parts=degree.split(/\s*[|·]\s*/);if(parts.length>1){degree=parts[0];for(const part of parts.slice(1)){if(/^(?:in progress|completed|not completed|incomplete|pursuing)$/i.test(part))status=status||part;else if(!field)field=part;else details=[details,part].filter(Boolean).join('\n');}}
  const inField=degree.match(/^(.+?)\s+in\s+(.+)$/i);if(inField){degree=inField[1];field=[inField[2],field].filter(Boolean).join(' · ');}
  for(const key of ['degree','field','institution','details']){
   let text={degree,field,institution,details}[key];const expected=text.match(/(?:[,;·|]?\s*)\b((?:expected|anticipated|projected(?:\s+graduation)?|graduating|graduated|completed|awarded)\s*(?::|-)?\s*(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+)?(?:19|20)\d{2})\b/i);
   if(expected){year=expected[1][0].toUpperCase()+expected[1].slice(1);text=(text.slice(0,expected.index)+text.slice(expected.index+expected[0].length)).trim().replace(/[,;|·\s]+$/,'');}
   if(key==='degree')degree=text;else if(key==='field')field=text;else if(key==='institution')institution=text;else details=text;
  }
  if(institution||degree||field||details)education.push({institution,degree,field,year,status,details});
 }
 for(const entry of cvRows(p.education))record(entry);
 const raw=extract(cvText(p.publicEducation));let block=[];
 function flush(){if(!block.length)return;const parts=block.flatMap(line=>line.split(/\s*[|·]\s*/)).map(cvText).filter(Boolean);let degree=parts.find(part=>degreePattern.test(part))||'',institution=parts.find(part=>/\b(?:university|college|institute|school|academy)\b/i.test(part))||'';const degreeSource=degree,institutionSource=institution;const combined=degree&&degree===institution?degree.match(degreePattern):null;if(combined&&combined.index>0){institution=degree.slice(0,combined.index).replace(/[,;|·\s]+$/,'');degree=degree.slice(combined.index);}else if(combined&&combined.index===0)institution='';const date=parts.find(part=>/^(?:(?:expected|anticipated|graduated|completed)\s+)?(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+)?(?:19|20)\d{2}$/i.test(part))||'',remaining=parts.filter(part=>part!==degreeSource&&part!==institutionSource&&part!==date);record({institution,degree,year:date,details:remaining.join('\n')});block=[];}
 for(const line of raw.split('\n')){if(!line.trim()){flush();continue;}if(block.length&&(degreePattern.test(line)&&block.some(v=>degreePattern.test(v))||/\b(?:university|college|institute|school|academy)\b/i.test(line)&&block.some(v=>/\b(?:university|college|institute|school|academy)\b/i.test(v))))flush();block.push(line);}flush();
 training.push(...cvTrainingEntries(p.publicTraining));
 const projects=cvRows(p.projects).map(e=>({...e,bullets:Array.isArray(e.bullets)?e.bullets.filter(x=>typeof x==='string'):[]}));if(p.publicProjects)for(const paragraph of p.publicProjects.split(/\n\s*\n/).filter(Boolean)){const lines=paragraph.split('\n').map(cvText).filter(Boolean);if(lines.length>1&&(/[|·]/.test(lines[0])||/^[•▪*\-]\s+/.test(lines[1]))){const [name,...role]=lines.shift().split(/\s*[|·]\s*/);projects.push({name,title:role.join(' · '),bullets:lines.map(v=>v.replace(/^[•▪*\-]\s+/,''))});}else projects.push({name:'Projects & volunteering',title:'',bullets:[flowParagraphs(paragraph)]});}
 const groups=cvSkillGroups(p.skills.technical,p.skills.leadership);const technical=groups.filter(g=>g.title!=='Leadership skills'),leadership=groups.filter(g=>g.title==='Leadership skills');
 const certEntries=cvUnique(certs.filter(Boolean).flatMap(source=>cvCredentialEntries(source).flatMap(e=>{if(/\b(?:training|course)\b/i.test(e.name)&&!/\b(?:certified|certificate|certification|license|diploma)\b/i.test(e.name)){training.push(...cvTrainingEntries([e.name,e.details].filter(Boolean).join(' | ')));return [];}return [[e.name,e.details].filter(Boolean).join(' — ')];}))); 
 return {...p,education:cvUnique(education),training:cvUnique(training),projects:cvUnique(projects),skills:{...p.skills,technical:technical.map(g=>(g.title==='Core skills'?'':g.title+': ')+g.items.join(', ')).join('\n'),leadership:leadership.flatMap(g=>g.items).join(', '),certs:certEntries.join('\n'),languages:cvListItems(p.skills.languages).join(', ')},publicEducation:'',publicTraining:'',publicProjects:''};
}

module.exports={cleanPublicCv,cvSkillGroups,cvListItems,cvCredentialEntries};
