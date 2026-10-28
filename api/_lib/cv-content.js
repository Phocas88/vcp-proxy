'use strict';
const {cleanResumeText,splitResumeSections,flowParagraphs,resumeHeading}=require('./resume-text');
// Only repair text already chosen for a public CV. Never fetch private fields.
function cleanPublicCv(value={}){
 const name=typeof value.name==='string'?value.name:'',sections=splitResumeSections(value.summary||'',{initial:'summary',name});
 const recoveredKeys=new Set(['skillsEntries','educationEntries','certifications','training','languages','projects']);
 const collect=(key,text)=>{if(text.trim())sections[key]+=(sections[key]?'\n':'')+text;};
 const cleanRows=rows=>(Array.isArray(rows)?rows:[]).filter(row=>row&&typeof row==='object'&&!Array.isArray(row)).map(row=>{
  let target=null;const bullets=[];
  for(const raw of (Array.isArray(row.bullets)?row.bullets:[]).filter(v=>typeof v==='string')){
   const kept=[];for(const line of cleanResumeText(raw,name).split('\n')){
    const heading=resumeHeading(line);if(heading&&recoveredKeys.has(heading.key)){target=heading.key;if(heading.rest)collect(target,heading.rest);}
    else if(heading){target=null;kept.push(line);}else if(target)collect(target,line);else kept.push(line);
   }
   const text=flowParagraphs(kept.join('\n'));if(text)bullets.push(text);
  }
  return {...row,title:typeof row.title==='string'?cleanResumeText(row.title,name):row.title,bullets};
 });
 const civilian=cleanRows(value.civilian),military=cleanRows(value.military),skills={...(value.skills&&typeof value.skills==='object'?value.skills:{})};
 for(const [source,key]of [['skillsEntries','technical'],['certifications','certs'],['languages','languages']]){
  const old=typeof skills[key]==='string'?cleanResumeText(skills[key],name):'',recovered=sections[source].trim();skills[key]=[old,recovered&&recovered!==old?recovered:''].filter(Boolean).join('\n');
 }
 return {...value,summary:flowParagraphs(sections.summary),skills,civilian,military,publicEducation:sections.educationEntries.trim(),publicTraining:sections.training.trim(),publicProjects:sections.projects.trim()};
}

module.exports={cleanPublicCv};
