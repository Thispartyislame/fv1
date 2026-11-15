const { chromium } = require('playwright');
const fs=require('fs');
(async()=>{
  const b=await chromium.launch({args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
  const ctx=await b.newContext({viewport:{width:1500,height:900},acceptDownloads:true});const p=await ctx.newPage();
  const logs=[];p.on('pageerror',e=>logs.push('PAGEERROR: '+e.message));p.on('console',m=>{if(m.type()==='error')logs.push('console.error: '+m.text())});p.on('dialog',d=>d.accept());
  await p.goto('file://'+require('path').resolve(__dirname,'../../fv1-studio.html'));await p.waitForTimeout(400);
  const names=await p.$$eval('#preset option',o=>o.map(x=>x.value||x.textContent));
  for(const n of names){await p.selectOption('#preset',n);await p.waitForTimeout(120);const e=await p.textContent('#errs');if(e)console.log('ERR',n,e);}
  console.log('presets ok',names.length);
  // undo/redo
  await p.selectOption('#preset','Echo');await p.waitForTimeout(100);
  const nodes0=await p.$$eval('.node',n=>n.length);
  await p.click('#palette button[data-type="drive"]');await p.waitForTimeout(700);
  const nodes1=await p.$$eval('.node',n=>n.length);
  await p.click('#btnUndo2');await p.waitForTimeout(200);const nodes2=await p.$$eval('.node',n=>n.length);
  await p.click('#btnRedo2');await p.waitForTimeout(200);const nodes3=await p.$$eval('.node',n=>n.length);
  console.log('undo/redo nodes',nodes0,nodes1,nodes2,nodes3);
  // A/B
  await p.selectOption('#preset','Tremolo');await p.waitForTimeout(100);
  await p.click('#btnAB');await p.waitForTimeout(200);await p.selectOption('#preset','Plate Reverb');await p.waitForTimeout(200);
  const sB=await p.textContent('#sM');await p.click('#btnAB');await p.waitForTimeout(200);
  console.log('A/B: B mem',sB,'A mem',await p.textContent('#sM'),await p.textContent('#btnAB'));
  // engine + level bars + render + audition
  await p.selectOption('#preset','Metal (Fromel-style)');await p.waitForTimeout(100);
  await p.click('#btnPower');await p.waitForTimeout(600);await p.click('#btnDemo');await p.waitForTimeout(1500);
  const w=await p.$$eval('.lvl i',e=>e.map(x=>x.style.width));console.log('level bars',w.join(' '));
  const [dl]=await Promise.all([p.waitForEvent('download',{timeout:60000}),p.click('#btnRender')]);
  const path=await dl.path();console.log('wav',dl.suggestedFilename(),fs.statSync(path).size,'bytes |',await p.textContent('#statMsg'));
  // store slot, audition, legend
  await p.click('[data-tab="chip"]');
  await p.selectOption('#preset','Echo');await p.waitForTimeout(150);
  await p.click('#slots .slot:nth-child(1) button:has-text("Store")');
  await p.click('#slots .slot:nth-child(1) button:has-text("Audition")');await p.waitForTimeout(500);console.log('audition:',(await p.textContent('#statMsg')).slice(0,60));
  const [dl2]=await Promise.all([p.waitForEvent('download'),p.click('#btnLegend')]);console.log(fs.readFileSync(await dl2.path(),'utf8').split('\n').slice(0,6).join(' | '));
  await p.screenshot({path:'test/shot5.png'});
  console.log(logs.join('\n')||'no errors');await b.close();
})();
