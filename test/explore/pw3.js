const { chromium } = require('playwright');
(async()=>{
  const b=await chromium.launch({args:['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required']});
  const p=await (await b.newContext({viewport:{width:1500,height:900},permissions:['microphone']})).newPage();
  const logs=[];p.on('console',m=>logs.push(m.type()+': '+m.text()));p.on('pageerror',e=>logs.push('PAGEERROR: '+e.message));
  await p.goto('file://'+require('path').resolve(__dirname,'../../fv1-studio.html'));
  await p.click('#btnPower'); await p.click('#btnDemo'); await p.waitForTimeout(500);
  for(const name of ['Octave Up','Whammy (POT0 = pitch)']){
    await p.selectOption('#preset',name); await p.waitForTimeout(1200);
    console.log(name,'| instr',await p.textContent('#sI'),'mem',await p.textContent('#sM'),'| err:',(await p.textContent('#errs'))||'-','| warns:',(await p.textContent('#warns'))||'-','| out meter',await p.evaluate(()=>document.querySelector('#mOut').style.width));
  }
  await p.screenshot({path:__dirname+'/shot5.png'});
  console.log(logs.join('\n')||'(no console output)');
  await b.close();
})();
