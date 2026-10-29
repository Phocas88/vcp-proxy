'use strict';
const crypto=require('node:crypto');
const protocol=require('./resume-analytics-protocol.json');
const ORIGINS=new Set(['https://vcp-proxy.vercel.app','https://veterancareerpath.com','https://www.veterancareerpath.com']);
const limits=new Map(),salt=crypto.randomBytes(16).toString('hex');
function limited(req,now){
 const ip=String(req.headers?.['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].slice(0,100);
 const key=crypto.createHash('sha256').update(salt+ip).digest('hex');
 if(limits.size>2000)for(const [key,row]of limits)if(now-row.start>60000)limits.delete(key);
 const row=limits.get(key);if(!row||now-row.start>60000){if(limits.size>=2000)return true;limits.set(key,{start:now,count:1});return false;}return ++row.count>60;
}
function aggregate(body){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['protocol','events'].includes(key))||body.protocol!=='vcp-resume-analytics-v1'||!Array.isArray(body.events)||!body.events.length||body.events.length>20)throw new Error('invalid_activity');
 const events={},screens={},sources={};
 for(const row of body.events){
  if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(key=>!['name','screen','source'].includes(key))||!Object.hasOwn(protocol.events,row.name)||row.name==='vcp_resume_active'||!Object.hasOwn(protocol.screens,row.screen)||!protocol.sources.includes(row.source))throw new Error('invalid_activity');
  events[row.name]=(events[row.name]||0)+1;
  if(row.name==='page_view'){screens[row.screen]=(screens[row.screen]||0)+1;sources[row.source]=(sources[row.source]||0)+1;}
 }
 return {events,screens,sources};
}
function createActivityHandler({db,increment,rateLimit=limited,now=Date.now}={}){
 return async(req,res)=>{
  const origin=req.headers?.origin;if(ORIGINS.has(origin))res.setHeader('Access-Control-Allow-Origin',origin);
  res.setHeader('Vary','Origin');res.setHeader('Cache-Control','no-store');res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(!ORIGINS.has(origin))return res.status(403).json({error:'origin_not_allowed'});
  if(req.method==='OPTIONS')return res.status(204).end();
  if(req.method!=='POST')return res.status(405).json({error:'method_not_allowed'});
  if(!String(req.headers?.['content-type']||'').startsWith('application/json'))return res.status(415).json({error:'json_required'});
  let totals;try{if(Buffer.byteLength(JSON.stringify(req.body||{}))>12000)throw new Error();totals=aggregate(req.body);}catch{return res.status(400).json({error:'invalid_activity'});}
  const time=now();if(rateLimit(req,time))return res.status(429).json({error:'activity_limit'});
  try{
   const store=db||require('./firebase-admin').getDb(),add=increment||require('./firebase-admin').FieldValue.increment;
   const date=new Date(time).toISOString().slice(0,10),patch={date,updatedAt:time};
   for(const group of ['events','screens','sources']){const values=Object.entries(totals[group]);if(values.length)patch[group]=Object.fromEntries(values.map(([key,value])=>[key,add(value)]));}
   await store.collection('_privateResumeActivityDaily').doc(date).set(patch,{merge:true});
   return res.status(204).end();
  }catch{return res.status(503).json({error:'activity_unavailable'});}
 };
}
module.exports={createActivityHandler,aggregate};
