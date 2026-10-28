'use strict';
// Shared formatting helpers, mirrored from the resume app. No private profile reads.
// Formatting cleanup only. Resume facts, credentials and dates are never inferred.
const sectionAliases={personal:['contact','personal details','personal information','contact information'],summary:['summary','professional summary','career summary','professional profile','profile','objective','career objective','about me','summary of qualifications'],roles:['military service','military experience','service experience','military career','service history'],jobs:['experience','work experience','professional experience','employment','employment history','work history','relevant experience','civilian experience','civilian & government jobs','civilian & government employment'],educationEntries:['education','academic background','educational background','education & training','education & professional development','education & credentials','education & certifications','academic qualifications'],certifications:['certifications','certification','credentials','certificates','licenses','licenses & certifications','certifications & licenses','professional certifications','licenses & credentials'],training:['training','professional development','professional training','military training','military schools','training & military schools','military schools & training'],skillsEntries:['skills','technical skills','core skills','key skills','core competencies','competencies','areas of expertise','skills & qualifications','technical proficiencies','technical & business skills','technical & professional skills','technical expertise','professional skills','technical & business competencies'],languages:['languages','language skills'],projects:['projects','selected projects','projects & volunteering','projects & volunteer experience','volunteer experience','volunteering','community involvement']};
const plain=v=>String(v||'').replace(/\u00a0/g,' ').replace(/[\u200b\ufeff]/g,'').trim();
const normalizeHeading=v=>plain(v).replace(/^#{1,6}\s*/,'').replace(/^\*\*|\*\*$/g,'').replace(/:$/,'').replace(/\s+and\s+/ig,' & ').replace(/\s+/g,' ').toLowerCase();
const headingMap=new Map(Object.entries(sectionAliases).flatMap(([key,list])=>list.map(label=>[normalizeHeading(label),key])));
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const prefixes=Object.entries(sectionAliases).flatMap(([key,list])=>list.map(label=>({key,regex:new RegExp('^'+label.split(' ').map(word=>word==='&'?'(?:and|&)':escape(word)).join('\\s+')+'(?=$|[\\s:|–—])','i')}))).sort((a,b)=>b.regex.source.length-a.regex.source.length);
function resumeHeading(value){
 const line=plain(value).replace(/^#{1,6}\s*/,'').replace(/^\*\*|\*\*$/g,'');const exact=headingMap.get(normalizeHeading(line));if(exact)return {key:exact,rest:''};
 for(const item of prefixes){const found=line.match(item.regex);if(!found)continue;const remainder=line.slice(found[0].length);if(/^\s*[:|–—]/.test(remainder)||/^\s{2,}\S/.test(remainder)||found[0]===found[0].toUpperCase()&&/[A-Z]/.test(found[0])&&remainder.trim())return {key:item.key,rest:remainder.replace(/^\s*[:|–—]?\s*/,'')};}
 return null;
}
function cleanResumeText(value,name=''){
 const lines=String(value||'').replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ').replace(/[\u200b\ufeff]/g,'').split('\n');
 const inferred=name||lines.slice(0,8).map(plain).find(line=>line.split(/\s+/).length>=2&&line.split(/\s+/).length<=6&&line.length<100&&!/[@\d:|/]/.test(line)&&!resumeHeading(line))||'';
 const names=new Set(inferred.toLocaleLowerCase().match(/[\p{L}’'-]+/gu)||[]);
 return lines.filter(line=>{const v=plain(line);if(/^(?:page\s+)?\d{1,3}\s*(?:\/|of)\s*\d{1,3}$/i.test(v)||/^page\s+\d{1,3}$/i.test(v))return false;const footer=v.match(/^(.+?)\s+(?:page\s+)?\d{1,3}\s*(?:\/|of)\s*\d{1,3}$/i);if(!footer)return true;const words=footer[1].toLocaleLowerCase().match(/[\p{L}’'-]+/gu)||[];return !words.length||!words.every(word=>names.has(word));}).map(line=>line.replace(/[ \t]+$/,'')).join('\n').trim();
}
function splitResumeSections(value,{initial='personal',name=''}={}){
 const sections=Object.fromEntries(Object.keys(sectionAliases).map(key=>[key,'']));let key=initial;
 for(const line of cleanResumeText(value,name).split('\n')){const heading=resumeHeading(line);if(heading){key=heading.key;if(heading.rest)sections[key]+=(sections[key]?'\n':'')+heading.rest;}else sections[key]+=(sections[key]?'\n':'')+line;}
 return sections;
}
function flowParagraphs(value){return String(value||'').trim().split(/\n\s*\n/).map(p=>p.replace(/\s*\n\s*/g,' ').replace(/[ \t]{2,}/g,' ').trim()).filter(Boolean).join('\n\n');}
function flowBullets(value){
 const result=[];let boundary=true,bullet=false;
 for(const raw of String(value||'').split('\n')){const line=raw.trim();if(!line){boundary=true;continue;}const marked=/^[•●▪◦*\-]\s+/.test(line),text=line.replace(/^[•●▪◦*\-]\s+/,'');if(!marked&&!boundary&&result.length&&(bullet||!/([.!?])$/.test(result.at(-1))))result[result.length-1]+=' '+text;else{result.push(text);bullet=marked;}boundary=false;}
 return result.join('\n');
}

module.exports={cleanResumeText,splitResumeSections,flowParagraphs,flowBullets,resumeHeading};
