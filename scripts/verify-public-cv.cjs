'use strict';
const assert=require('node:assert/strict'),{mkdir}=require('node:fs/promises');
const {chromium}=require('playwright');
const {renderDigitalCv}=require('../api/_lib/digital-cv-page');
const fixture=require('./fixtures/public-cv.cjs');
(async()=>{await mkdir('public-cv-previews',{recursive:true});const browser=await chromium.launch({headless:true});let checks=0;try{
 for(const width of [360,390,768,1440]){
  const page=await browser.newPage({viewport:{width,height:width>=1000?1100:844},deviceScaleFactor:1});const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setContent(renderDigitalCv(fixture,'vcp-resume-fictional-example'));await page.locator('h1').waitFor();
  assert.equal(await page.locator('h1').textContent(),fixture.name);assert.equal(await page.locator('.cv-position').count(),3);assert.equal(await page.locator('a[href^="mailto:"]').count(),1);assert.equal(await page.locator('script,img').count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);checks+=5;
  const main=await page.locator('.cv-primary').boundingBox(),aside=await page.locator('.cv-support').boundingBox();if(width>=1000)assert.ok(aside.x>main.x+main.width);else assert.ok(aside.y>main.y+main.height);checks++;
  await page.locator('.cv-jump a[href="#education"]').click();assert.equal(await page.locator('#education').count(),1);checks++;
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'public-cv-previews/complete-'+width+'.png',fullPage:true});assert.deepEqual(errors,[]);checks++;await page.close();
 }
 const page=await browser.newPage({viewport:{width:360,height:800}});await page.setContent(renderDigitalCv({...fixture,name:'Alexandra Morgan-Washington',summary:'Long career detail '.repeat(100),skills:{technical:'A'.repeat(400)},contact:{email:'long-published-contact-address@example.com'},civilian:[{title:'Senior Operations and Cross-Functional Logistics Coordinator',employer:'Example Very Long Employer Name',startDate:'2020-01',current:true,bullets:['Full verified accomplishment '.repeat(25)]}]},'vcp-resume-fictional-long'));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.locator('.cv-bullets').innerText().then(t=>t.includes('Full verified accomplishment')),true);checks+=2;await page.screenshot({path:'public-cv-previews/long-content-360.png',fullPage:true});
 await page.emulateMedia({media:'print'});assert.equal(await page.locator('.cv-masthead').isVisible(),false);assert.equal(await page.locator('.cv-position').isVisible(),true);await page.pdf({path:'public-cv-previews/print-example.pdf',format:'Letter',printBackground:true});checks+=2;
 await page.emulateMedia({media:'screen'});await page.setContent(renderDigitalCv({name:'Alex Example',civilian:fixture.civilian,contact:{}},'vcp-resume-fictional-civilian'));assert.equal(await page.locator('a[href^="mailto:"],a[href^="tel:"]').count(),0);assert.equal((await page.locator('body').innerText()).includes('U.S. Military Veteran'),false);checks+=2;await page.screenshot({path:'public-cv-previews/civilian-360.png',fullPage:true});
 console.log('Public CV browser verification passed: '+checks+' checks across four screen sizes, long content, privacy and print.');
 }finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
