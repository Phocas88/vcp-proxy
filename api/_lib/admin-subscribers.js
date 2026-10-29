'use strict';
const {requireAdmin}=require('./admin-auth');
const {stripeGet}=require('./stripe');
const ORIGINS=new Set(['https://veterancareerpath.com','https://www.veterancareerpath.com']);
const SUBSCRIPTION_ID=/^sub_[A-Za-z0-9]{1,120}$/;

// Return only fields used by the owner dashboard, never Stripe's full objects.
function subscriber(subscription){
 const customer=subscription.customer&&typeof subscription.customer==='object'&&!subscription.customer.deleted?subscription.customer:{};
 const items=Array.isArray(subscription.items?.data)?subscription.items.data:[];
 const first=items[0],price=first?.price;
 const currency=typeof subscription.currency==='string'?subscription.currency:price?.currency;
 const samePrices=items.length>0&&items.every(item=>Number.isSafeInteger(item.price?.unit_amount)&&item.price.currency===currency&&item.price.recurring?.interval===price?.recurring?.interval&&item.price.recurring?.interval_count===price?.recurring?.interval_count);
 const amount=samePrices?items.reduce((sum,item)=>sum+item.price.unit_amount*(Number.isSafeInteger(item.quantity)?item.quantity:1),0):null;
 const end=Number(subscription.current_period_end)||Math.min(...items.map(item=>Number(item.current_period_end)).filter(value=>value>0));
 return {id:subscription.id,email:typeof customer.email==='string'?customer.email:'',name:typeof customer.name==='string'?customer.name:'',status:subscription.status,amount:Number.isSafeInteger(amount)?amount:null,currency:currency||'usd',interval:price?.recurring?.interval||null,intervalCount:price?.recurring?.interval_count||1,created:Number(subscription.created)*1000||null,currentPeriodEnd:Number.isFinite(end)&&end>0?end*1000:null,cancelAtPeriodEnd:subscription.cancel_at_period_end===true};
}
function createSubscribersHandler({authorize=requireAdmin,get=stripeGet,key=()=>process.env.STRIPE_SECRET_KEY}={}){
 return async function handler(req,res){
  const origin=req.headers?.origin;
  if(ORIGINS.has(origin))res.setHeader('Access-Control-Allow-Origin',origin);
  res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method==='OPTIONS')return res.status(204).end();
  if(req.method!=='GET')return res.status(405).json({error:'method_not_allowed'});
  const admin=await authorize(req);
  if(!admin.ok)return res.status(admin.status).json({error:admin.error});
  const cursor=req.query?.cursor;
  if(cursor!==undefined&&(typeof cursor!=='string'||!SUBSCRIPTION_ID.test(cursor)))return res.status(400).json({error:'invalid_cursor'});
  const secret=key();if(!secret)return res.status(503).json({error:'billing_not_configured'});
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
  try{
   const params=new URLSearchParams({status:'all',limit:'100','expand[]':'data.customer'});if(cursor)params.set('starting_after',cursor);
   const result=await get('/v1/subscriptions?'+params,secret,controller.signal);
   if(!Array.isArray(result.data))throw new Error('invalid_billing_response');
   const subscriptions=result.data.filter(item=>item&&SUBSCRIPTION_ID.test(item.id)).map(subscriber);
   const last=result.data.at(-1)?.id,nextCursor=result.has_more===true&&SUBSCRIPTION_ID.test(last)?last:null;
   return res.status(200).json({subscribers:subscriptions,nextCursor,hasMore:nextCursor!==null});
  }catch(error){
   const timedOut=controller.signal.aborted||error?.name==='AbortError';
   return res.status(timedOut?504:503).json({error:timedOut?'billing_timeout':'billing_unavailable'});
  }finally{clearTimeout(timeout);}
 };
}
module.exports={createSubscribersHandler,subscriber};
