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
