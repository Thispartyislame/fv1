const { chromium } = require('/opt/npm-tools/node_modules/playwright');
(async()=>{
  const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required']});
  const ctx=await b.newContext({viewport:{width:1366,height:768},permissions:['microphone']});const p=await ctx.newPage();
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.goto('file:///home/claude/fv1/fv1-studio.html');await p.waitForTimeout(500);
  const names=await p.$$eval('#preset option',o=>o.map(x=>x.value||x.textContent));
  for(const n of names){await p.selectOption('#preset',n);await p.waitForTimeout(300);
    const r=await p.evaluate(()=>{const cv=document.querySelector('#canvas').getBoundingClientRect();
      const off=[...document.querySelectorAll('.node')].filter(e=>{const r=e.getBoundingClientRect();return !(r.top>=cv.top-1&&r.bottom<=cv.bottom+1&&r.left>=cv.left-1&&r.right<=cv.right+1)}).map(e=>e.querySelector('.nhead span').textContent);
      return {off,cables:document.querySelectorAll('#cables path:not(.hit)').length,edges:window.__fv1.graph.edges.length,pots:window.__fv1.graph.nodes.filter(n=>n.type=='pot').length,err:document.querySelector('#errs').textContent};});
    console.log(n.padEnd(24),'cables',r.cables+'/'+r.edges,'pots',r.pots,'offscreen:',r.off.join(',')||'-',r.err||'');}
  // drag cable at zoomed view: Echo, move pot cable
  await p.selectOption('#preset','Overdrive');await p.waitForTimeout(300);
  const outDot=await p.$('.node[data-id="p1"] .dot');const ob=await outDot.boundingBox();
  // disconnect by dragging an input dot of filter.freq to empty space, reconnect back
  const inDot=await p.$('.node[data-id="n3"] .dot[data-port="freq"]');const ib=await inDot.boundingBox();
  await p.mouse.move(ob.x+6,ob.y+6);await p.mouse.down();await p.mouse.move(ib.x+6,ib.y+6,{steps:5});await p.mouse.up();await p.waitForTimeout(150);
  console.log('re-drop at zoom: edges',await p.evaluate(()=>window.__fv1.graph.edges.length),'(expect 4)');
  // live input on fake device
  await p.click('#btnPower');await p.waitForTimeout(500);await p.click('#btnMic');await p.waitForTimeout(1500);
  console.log('input status:',await p.textContent('#inStat'));
  await p.selectOption('#chanSel','R');await p.waitForTimeout(500);console.log('R:',await p.textContent('#inStat'));
  console.log(errs.join('\n')||'no page errors');await b.close();})();
