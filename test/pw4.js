const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs=require('fs');
(async()=>{
  const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
  const p=await (await b.newContext({viewport:{width:1500,height:900}})).newPage();
  const logs=[];p.on('pageerror',e=>logs.push('PAGEERROR: '+e.message));p.on('dialog',d=>d.accept());
  await p.goto('file:///home/claude/fv1/fv1-studio.html');await p.waitForTimeout(400);
  // all presets compile
  const names=await p.$$eval('#preset option',o=>o.map(x=>x.value||x.textContent));
  for(const n of names){await p.selectOption('#preset',n);await p.waitForTimeout(150);
    console.log(n.padEnd(26),'instr',await p.textContent('#sI'),'regs',await p.textContent('#sR'),'err:',(await p.textContent('#errs'))||'-');}
  // tooltip on a port
  await p.selectOption('#preset','Metal (Fromel-style)');await p.waitForTimeout(200);
  const dot=await p.$('.node .dot[data-port="midf"]');const bb=await dot.boundingBox();
  await p.mouse.move(bb.x+5,bb.y+5);await p.waitForTimeout(150);
  console.log('tooltip:',JSON.stringify(await p.textContent('#tip')),await p.$eval('#tip',e=>getComputedStyle(e).display));
  // drag highlight
  const od=await p.$('.node .dot[data-dir="out"][data-port="out"]');const ob=await od.boundingBox();
  await p.mouse.move(ob.x+5,ob.y+5);await p.mouse.down();await p.mouse.move(ob.x+60,ob.y+40);await p.waitForTimeout(100);
  console.log('green targets',await p.$$eval('.dot.tgt',e=>e.length),'amber',await p.$$eval('.dot.tgt2',e=>e.length),'hint:',(await p.textContent('#tip')).slice(0,40));
  await p.screenshot({path:'shot_drag.png'});
  await p.mouse.up();
  console.log('after drop targets',await p.$$eval('.dot.tgt',e=>e.length));
  // import: hex from generated bank
  const A=require('../src/fv1asm.js'),P=require('../src/patch.js');
  const bank=[];for(const k of ['Echo','Plate Reverb','Auto-Wah','Phaser','Metal (Fromel-style)']){bank.push(A.assemble(P.generate(P.PRESETS[k]).asm).words);}
  const img=A.buildBankImage(bank);fs.writeFileSync('imp.hex',A.toIntelHex(img));fs.writeFileSync('imp.bin',Buffer.from(img));
  for(const f of ['imp.hex','imp.bin']){
    await p.click('#btnHand').catch(()=>{});
    await p.setInputFiles('#fileImport','/home/claude/fv1/test/'+f);await p.waitForTimeout(500);
    console.log(f,'|',await p.textContent('#statMsg'),'| slots filled',await p.$$eval('.slot input[type=text], .slot input:not([type])',e=>e.filter(x=>x.value).length),'errs',(await p.textContent('#errs'))||'-','instr',await p.textContent('#sI'));
  }
  await p.setInputFiles('#fileImport','/home/claude/fv1/test/gen/Echo.spn');await p.waitForTimeout(300);
  console.log('spn:',await p.textContent('#statMsg'),'instr',await p.textContent('#sI'));
  console.log(logs.join('\n')||'no page errors');
  await b.close();
})();
