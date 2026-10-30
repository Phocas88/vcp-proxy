// One writing model policy for paid documents. No resume text or credentials
// are logged, and a model-access fallback shares the original timeout/receipt.
export const DEFAULT_DOCUMENT_MODEL='gpt-5.4';
const configured=value=>typeof value==='string'&&/^[a-zA-Z0-9._:-]{1,120}$/.test(value)?value:'';
export async function requestDocument({apiKey,model,fetcher=fetch,instructions,input,schema,name,maxOutputTokens,signal}){
 const primary=configured(model)||configured(process.env.VCP_DOCUMENT_AI_MODEL)||DEFAULT_DOCUMENT_MODEL;
 const fallback=configured(process.env.VCP_DOCUMENT_AI_FALLBACK_MODEL)||'gpt-4.1-mini';
 const send=selected=>fetcher('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+apiKey},body:JSON.stringify({model:selected,store:false,instructions,input,max_output_tokens:maxOutputTokens,...(/^gpt-5(?:[.-]|$)/.test(selected)?{reasoning:{effort:'low'}}:{}),text:{format:{type:'json_schema',name,strict:true,schema}}}),signal});
 const response=await send(primary);
 if(response.ok||primary===fallback||signal?.aborted||![400,403,404].includes(response.status))return response;
 let code;try{code=(await (response.clone?response.clone():response).json())?.error?.code;}catch{return response;}
 if(!['model_not_found','model_access_denied','invalid_model'].includes(code))return response;
 // Do not retry authentication, billing, rate limiting, transport, content or
 // malformed-output failures as a model-access problem.
 console.warn('[document-ai] configured writing model unavailable; using model-access fallback');
 return send(fallback);
}
