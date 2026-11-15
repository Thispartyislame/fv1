const A=require('../../src/fv1asm.js'),E=require('../../src/fv1emu.js'),P=require('../../src/patch.js');
function sim(asm, secs, inFn, pots){
  const r=A.assemble(asm); if(r.errors.length){console.log(asm);throw new Error(JSON.stringify(r.errors));}
  const e=new E(32000); e.onwarn=m=>console.log('WARN',m); e.load(r.words);
  const out=[]; const n=Math.round(secs*32000);
  for(let i=0;i<n;i++){ (pots||[]).forEach((v,k)=>e.reg[0x10+k]=v); const x=inFn(i); const [l,rr]=e.step(x,x); out.push([l,rr]); }
  return {r,out,e};
}
const rms=(a,s,t)=>{let q=0;for(let i=s;i<t;i++)q+=a[i]*a[i];return Math.sqrt(q/Math.max(1,t-s));};
for(const [name,g] of Object.entries(P.PRESETS)){
  const gen=P.generate(g);
  if(gen.errors.length){console.log(name,'GEN ERR',gen.errors);continue;}
  const burst=i=>i<3200?0.5*Math.sin(2*Math.PI*220*i/32000)*(1-i/3200):0;
  const s=sim(gen.asm,4,burst,[0.5,0.5,0.5]);
  const L=s.out.map(o=>o[0]);
  const finite=L.every(Number.isFinite), peak=L.reduce((m,x)=>Math.max(m,Math.abs(x)),0);
  console.log(name.padEnd(22),'instr',String(s.r.ninstr).padStart(3),'mem',String(s.r.memUsed).padStart(5),'regs',gen.stats.regs,'warn',s.r.warnings.length,'finite',finite,'peak',peak.toFixed(3),
   'rms[0-.1s]',rms(L,0,3200).toFixed(3),'[.5-1s]',rms(L,16000,32000).toFixed(4),'[3-4s]',rms(L,96000,128000).toFixed(5));
  if(s.r.warnings.length)console.log('  ',s.r.warnings.map(w=>w.msg));
}
