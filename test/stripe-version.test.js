'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {stripeGet,stripePost}=require('../api/_lib/stripe');

test('resume requests can pin no-cost-compatible Stripe version without changing other integrations',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({id:'cs_test'})};});
 await stripePost('/v1/checkout/sessions',{allow_promotion_codes:true},'placeholder',undefined,'order-key','2024-06-20');
 await stripeGet('/v1/checkout/sessions/cs_test','placeholder',undefined,'2024-06-20');
 await stripeGet('/v1/customers/cus_test','placeholder');
 await stripePost('/v1/checkout/sessions',{},'placeholder');
 assert.equal(calls[0].options.headers['Stripe-Version'],'2024-06-20');assert.equal(calls[1].options.headers['Stripe-Version'],'2024-06-20');
 assert.equal(calls[0].options.headers['Idempotency-Key'],'order-key');assert.equal(calls[0].options.body,'allow_promotion_codes=true');
 assert.equal(calls[2].options.headers['Stripe-Version'],undefined);assert.equal(calls[3].options.headers['Stripe-Version'],undefined);
});
