const { chromium } = require('/opt/npm-tools/node_modules/playwright');
(async()=>{
  const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
  const p=await (await b.newContext({viewport:{width:1366,height:768}})).newPage();
  await p.goto('file:///home/claude/fv1/fv1-studio.html');await p.waitForTimeout(400);
  const names=await p.$$eval('#preset option',o=>o.map(x=>x.value||x.textContent));
  for(const n of names){await p.selectOption('#preset',n);await p.waitForTimeout(250);
    const r=await p.evaluate(()=>{const cv=document.querySelector('#canvas').getBoundingClientRect();
      const nodes=[...document.querySelectorAll('.node')].map(e=>{const r=e.getBoundingClientRect();return {t:e.querySelector('.nhead span').textContent,vis:r.top>=cv.top&&r.bottom<=cv.bottom&&r.left>=cv.left&&r.right<=cv.right}});
      return {nodes,cables:document.querySelectorAll('#cables path:not(.hit)').length,edges:window.__fv1.graph.edges.length,cv:[Math.round(cv.width),Math.round(cv.height)]};});
    console.log(n.padEnd(24),'cables',r.cables,'/',r.edges,'canvas',r.cv.join('x'),'offscreen:',r.nodes.filter(x=>!x.vis).map(x=>x.t).join(',')||'-');}
  await b.close();})();
