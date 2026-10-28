'use strict';

// PDF text often wraps a sentence or uses ligatures, nonbreaking spaces and
// typographic quotes. Match those formatting differences without accepting a
// paraphrase, removing words, or changing numbers. Return the ORIGINAL passage.
function folded(value){
 const chars=[],starts=[],ends=[];let offset=0;
 for(const original of String(value||'')){
  const start=offset;offset+=original.length;
  const normalized=original.normalize('NFKC').toLowerCase().replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/[\u2010-\u2015\u2212]/g,'-').replace(/[\u00ad\u200b\ufeff]/g,'');
  for(const char of normalized.split('')){
   if(/\s/u.test(char)){
    if(chars.at(-1)===' '){ends[ends.length-1]=offset;continue;}
    chars.push(' ');starts.push(start);ends.push(offset);
   }else{chars.push(char);starts.push(start);ends.push(offset);}
  }
 }
 return {text:chars.join(''),starts,ends};
}
function evidenceReader(source){
 const original=String(source||''),indexed=folded(original);
 return quote=>{
  if(typeof quote!=='string')return '';
  const text=quote.trim().slice(0,1200);if(text.length<8)return '';
  if(original.includes(text))return text;
  const candidate=folded(text).text.trim();if(candidate.length<8)return '';
  const index=indexed.text.indexOf(candidate);if(index<0)return '';
  return original.slice(indexed.starts[index],indexed.ends[index+candidate.length-1]);
 };
}
module.exports={evidenceReader};

// Constrain the model's evidence choices to passages from the original source.
// This prevents a useful career from being discarded because its supporting
// sentence was paraphrased. No words or numbers are generated for these choices.
function evidencePassages(source){
 const original=String(source||'');
 const chunk=value=>{const parts=[];let rest=value.trim();while(rest.length>1000){const space=rest.lastIndexOf(' ',1000),cut=space>500?space:1000;parts.push(rest.slice(0,cut).trim());rest=rest.slice(cut).trim();}if(rest.length>=8)parts.push(rest);return parts;};
 let passages=[...original.matchAll(/[^\r\n]+/g)].flatMap(match=>chunk(match[0]));
 // Keep the response schema below the provider's enum limits without losing
 // later sections of resumes containing hundreds of very short lines.
 if(passages.length>512)passages=chunk(original);
 return [...new Set(passages.filter(p=>p.length>=8))];
}
module.exports.evidencePassages=evidencePassages;
