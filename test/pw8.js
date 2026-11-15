const { chromium } = require('/opt/npm-tools/node_modules/playwright');
(async()=>{
  const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required']});
  const p=await (await b.newContext({permissions:['microphone']})).newPage();
  await p.goto('file:///home/claude/fv1/fv1-studio.html');await p.waitForTimeout(400);
  await p.click('#btnPower');await p.waitForTimeout(400);await p.click('#btnMic');
  for(let i=0;i<8;i++){await p.waitForTimeout(500);console.log(await p.textContent('#inStat'),'| meter in',await p.$eval('#mIn',e=>e.style.width));}
  await b.close();})();
