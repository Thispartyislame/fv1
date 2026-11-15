const { chromium } = require('playwright');
(async()=>{
  const b=await chromium.launch({args:['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required']});
  const ctx=await b.newContext({viewport:{width:1500,height:900},permissions:['microphone']});
  const p=await ctx.newPage();
  const logs=[];p.on('console',m=>logs.push(m.type()+': '+m.text()));p.on('pageerror',e=>logs.push('PAGEERROR: '+e.message));
  await p.goto('file://'+require('path').resolve(__dirname,'../../fv1-studio.html'));
  await p.waitForTimeout(500);
  console.log('nodes',await p.$$eval('.node',n=>n.length),'cables',await p.$$eval('#cables path:not(.hit)',n=>n.length),'instr',await p.textContent('#sI'),'mem',await p.textContent('#sM'),'err:',await p.textContent('#errs'));
  await p.screenshot({path:__dirname+'/shot1.png'});
  // start audio and demo
  await p.click('#btnPower'); await p.waitForTimeout(800);
  console.log('power btn:',await p.textContent('#btnPower'),'| status:',await p.textContent('#statMsg'));
  await p.click('#btnDemo'); await p.waitForTimeout(1500);
  console.log('loop state:',await p.textContent('#loopState'),await p.textContent('#loopTime'));
  const meters=await p.evaluate(()=>[document.querySelector('#mIn').style.width,document.querySelector('#mOut').style.width]);
  console.log('meters in/out',meters);
  // mic + record
  await p.click('#btnMic'); await p.waitForTimeout(800);
  console.log('mic btn:',await p.textContent('#btnMic'),await p.textContent('#statMsg'));
  await p.click('#btnRec'); await p.waitForTimeout(1500); await p.click('#btnRec'); await p.waitForTimeout(600);
  console.log('after rec:',await p.textContent('#loopState'),await p.textContent('#loopTime'));
  // switch presets
  for (const name of ['Plate Reverb','Chorus','Tremolo','Overdrive','Clean (pass-through)']) {
    await p.selectOption('#preset',name); await p.waitForTimeout(300);
    console.log(name.padEnd(22),'instr',await p.textContent('#sI'),'mem',await p.textContent('#sM'),'regs',await p.textContent('#sR'),'err:',(await p.textContent('#errs'))||'-');
  }
  await p.selectOption('#preset','Echo'); await p.waitForTimeout(300);
  // add node via palette, drag a cable
  await p.click('#palette button[data-type="drive"]'); await p.waitForTimeout(200);
  console.log('nodes after add',await p.$$eval('.node',n=>n.length));
  await p.screenshot({path:__dirname+'/shot2.png'});
  // chip tab
  await p.click('.tabs button[data-tab="chip"]'); await p.click('#slots .slot:nth-child(1) button'); await p.waitForTimeout(200);
  console.log('bank info:',await p.textContent('#bankInfo'));
  await p.screenshot({path:__dirname+'/shot3.png'});
  console.log(logs.join('\n')||'(no console output)');
  await b.close();
})();
