'use strict';
const {stripeGet}=require('./stripe');
const protocol=require('./resume-analytics-protocol.json');
const PRODUCTS={'vcp-resume-workspace':'resume','vcp-resume-template':'template'};
const ORIGINS=new Set(['https://veterancareerpath.com','https://www.veterancareerpath.com']);
function purchase(session){
 if(!session||typeof session!=='object'||!/^cs_[A-Za-z0-9_]+$/.test(session.id||''))return null;
 const service=Object.hasOwn(PRODUCTS,session.metadata?.product)?PRODUCTS[session.metadata.product]:null,amount=session.amount_total,discount=session.total_details?.amount_discount||0;
 if(!service||session.mode!=='payment'||session.status!=='complete'||!Number.isSafeInteger(amount)||amount<0||!['paid','no_payment_required'].includes(session.payment_status)||session.payment_status==='no_payment_required'&&amount!==0)return null;
 const charge=session.payment_intent&&typeof session.payment_intent==='object'?session.payment_intent.latest_charge:null;
 const refunded=charge&&typeof charge==='object'&&Number.isSafeInteger(charge.amount_refunded)?Math.min(amount,Math.max(0,charge.amount_refunded)):0;
 const testMode=session.livemode===false,paymentBase='https://dashboard.stripe.com/'+(testMode?'test/':'')+'payments';
 const intent=typeof session.payment_intent==='string'?session.payment_intent:session.payment_intent?.id;
 return {id:session.id,testMode,createdAt:Number(session.created)*1000,service,design:service==='template'&&typeof session.metadata.design==='string'?session.metadata.design.slice(0,80):null,email:typeof session.customer_details?.email==='string'?session.customer_details.email:'',name:typeof session.customer_details?.name==='string'?session.customer_details.name:'',amount,currency:typeof session.currency==='string'?session.currency:'usd',discount:Number.isSafeInteger(discount)?discount:0,refunded,status:amount===0?'promo':refunded===amount?'refunded':refunded>0?'partially_refunded':'paid',stripeUrl:typeof intent==='string'&&/^pi_[A-Za-z0-9_]+$/.test(intent)?paymentBase+'/'+intent:paymentBase+'?query='+encodeURIComponent(session.id)};
}
function cleanCounts(value,allowed){return Object.fromEntries(Object.entries(value&&typeof value==='object'?value:{}).filter(([key,count])=>allowed.includes(key)&&Number.isSafeInteger(count)&&count>=0));}
function createAdminResumeHandler({authorize=req=>require('./admin-auth').requireAdmin(req),get=stripeGet,key=()=>process.env.STRIPE_SECRET_KEY,db,now=Date.now}={}){
 return async(req,res)=>{
  if(ORIGINS.has(req.headers?.origin))res.setHeader('Access-Control-Allow-Origin',req.headers.origin);
  res.setHeader('Vary','Origin');res.setHeader('Cache-Control','no-store');res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
  if(req.method==='OPTIONS')return res.status(204).end();if(req.method!=='GET')return res.status(405).json({error:'method_not_allowed'});
  const admin=await authorize(req);if(!admin.ok)return res.status(admin.status).json({error:admin.error});
  const view=req.query?.view||'purchases',days=String(req.query?.days||'30'),cursor=req.query?.cursor;
  const validCursor=cursor===undefined||typeof cursor==='string'&&(view==='purchases'?/^cs_[A-Za-z0-9_]{1,180}$/.test(cursor):view==='feedback'?/^[a-f0-9]{64}$/.test(cursor):false);
  if(!['purchases','activity','feedback'].includes(view)||!['7','30','90','all'].includes(days)||!validCursor)return res.status(400).json({error:'invalid_report'});
  const end=now(),start=days==='all'?0:Date.UTC(new Date(end).getUTCFullYear(),new Date(end).getUTCMonth(),new Date(end).getUTCDate())-(Number(days)-1)*86400000;
  if(view==='feedback'){
   try{
    const store=db||require('./firebase-admin').getDb(),collection=store.collection(require('./resume-feedback').COLLECTION);
    let query=collection.orderBy('createdAt','desc');if(start)query=query.where('createdAt','>=',start);
    if(cursor){const last=await collection.doc(cursor).get();if(!last.exists)return res.status(400).json({error:'invalid_report'});query=query.startAfter(last);}
    const snap=await query.limit(51).select('rating','comment','createdAt').get(),page=snap.docs.slice(0,50);
    const feedback=page.map(doc=>({id:doc.id,...doc.data()})).filter(row=>Number.isInteger(row.rating)&&row.rating>=1&&row.rating<=5&&Number.isSafeInteger(row.createdAt)).map(row=>({id:row.id,rating:row.rating,comment:typeof row.comment==='string'?row.comment.slice(0,1000):'',createdAt:row.createdAt}));
    return res.status(200).json({feedback,nextCursor:snap.docs.length>50?page.at(-1).id:null,period:days,asOf:end});
   }catch{return res.status(503).json({error:'feedback_unavailable'});}
  }
  if(view==='activity'){
   try{
    const store=db||require('./firebase-admin').getDb(),since=new Date(days==='all'?end-89*86400000:start).toISOString().slice(0,10);
    const snap=await store.collection('_privateResumeActivityDaily').where('date','>=',since).orderBy('date','asc').limit(90).select('date','events','screens','sources').get();
    const rows=snap.docs.map(doc=>doc.data()).filter(row=>/^\d{4}-\d{2}-\d{2}$/.test(row.date)).map(row=>({date:row.date,events:cleanCounts(row.events,Object.keys(protocol.events)),screens:cleanCounts(row.screens,Object.keys(protocol.screens)),sources:cleanCounts(row.sources,protocol.sources)}));
    return res.status(200).json({days:rows,period:days==='all'?'90':days,asOf:end,recordingSince:'2026-10-29',screenLabels:protocol.screens});
   }catch{return res.status(503).json({error:'activity_unavailable'});}
  }
  const secret=key();if(!secret)return res.status(503).json({error:'billing_not_configured'});
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),18000);
  try{
   const purchases=[];let next=cursor||null,hasMore=true,scanned=0;
   for(let page=0;page<5&&hasMore;page++){
    const params=new URLSearchParams({limit:'100',status:'complete','expand[]':'data.payment_intent.latest_charge'});if(start)params.set('created[gte]',String(Math.floor(start/1000)));if(next)params.set('starting_after',next);
    const result=await get('/v1/checkout/sessions?'+params,secret,controller.signal,'2024-06-20');
    if(!Array.isArray(result.data))throw new Error('invalid_billing_response');
    scanned+=result.data.length;for(const session of result.data){const row=purchase(session);if(row)purchases.push(row);}
    hasMore=result.has_more===true;next=hasMore?result.data.at(-1)?.id:null;if(hasMore&&(!next||!/^cs_[A-Za-z0-9_]+$/.test(next)))throw new Error('invalid_cursor');
    if(purchases.length>=50)break;
   }
   return res.status(200).json({purchases,nextCursor:next,hasMore,scanned,period:days,asOf:end});
  }catch(error){return res.status(controller.signal.aborted||error.name==='AbortError'?504:503).json({error:controller.signal.aborted||error.name==='AbortError'?'billing_timeout':'billing_unavailable'});}finally{clearTimeout(timeout);}
 };
}
module.exports={createAdminResumeHandler,purchase};
