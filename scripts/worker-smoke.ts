import {chromium} from 'playwright';
async function main(){
 const browser=await chromium.launch({headless:true,timeout:30000});
 try{
  const page=await browser.newPage();
  await page.goto('about:blank');
  if(await page.title()!=='')throw new Error('Unexpected smoke page title');
  console.log('Chromium sandbox smoke check: OK');
 }finally{await browser.close();}
}
main().catch(e=>{console.error('Chromium smoke check FAILED:',e instanceof Error?e.message:String(e));process.exitCode=1;});
