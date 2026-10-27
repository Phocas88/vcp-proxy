'use strict';
const {DESIGNS}=require('./resume-templates');
const fail=(status,message)=>Object.assign(new Error(message),{status,public:true});

// Delete one finished document and its account-library mirror, while preserving
// other templates, the submitted source, and the original payment receipt.
async function deleteSavedTemplate({db,ref,uid,id,design,now}){
 if(!DESIGNS.has(design))throw fail(400,'Choose a saved resume template.');
 const finished=ref.collection('finishedResumes').doc(design);
 const mirror=db.collection('profiles').doc(uid).collection('resumeProgramResumes').doc('finished-'+id+'-'+design);
 return db.runTransaction(async tx=>{
  const snap=await tx.get(ref);if(!snap.exists||snap.data().status==='deleted')throw fail(410,'This resume purchase was deleted.');
  const data=snap.data();if(!(data.templates||[]).includes(design))throw fail(404,'That saved template does not belong to this purchase.');
  if(data.status==='running'&&data.leaseUntil>now())throw fail(409,'Wait for the resume review to finish before deleting a document.');
  tx.update(ref,{deletedTemplates:[...new Set([...(data.deletedTemplates||[]),design])],updatedAt:now()});
  tx.delete(finished);tx.delete(mirror);
  return {deleted:true,design};
 });
}
async function deleteBuildMirrors({db,uid,id,templates=[]}){
 const library=db.collection('profiles').doc(uid).collection('resumeProgramResumes');
 for(const key of ['draft-'+id,...templates.map(design=>'finished-'+id+'-'+design)])await library.doc(key).delete();
}
module.exports={deleteSavedTemplate,deleteBuildMirrors};
