const A=require('../src/fv1asm.js'),E=require('../src/fv1emu.js'),P=require('../src/patch.js');
const N=(id,type,p)=>({id,type,x:0,y:0,p:Object.assign(P.defaultParams(type),p||{})});
function run(g,secs,inFn,pots){const gen=P.generate(g);if(gen.errors.length)throw new Error(gen.errors[0]);const r=A.assemble(gen.asm);if(r.errors.length)throw new Error(JSON.stringify(r.errors)+gen.asm);
 const e=new E(32000);e.onwarn=m=>console.log('WARN',m);e.load(r.words);const n=secs*32000,L=new Float64Array(n);
 for(let i=0;i<n;i++){(pots||[]).forEach((v,k)=>e.reg[0x10+k]=v);const o=e.step(inFn(i),0);L[i]=o[0];}return {L,gen,r};}
// estimate frequency by zero crossings (rising) over a window
function freq(L,s,t){let c=0,first=-1,last=-1;for(let i=s+1;i<t;i++)if(L[i-1]<0&&L[i]>=0){c++;if(first<0)first=i;last=i;}return c>1?(c-1)*32000/(last-first):0;}
const rms=(a,s,t)=>{let q=0;for(let i=s;i<t;i++)q+=a[i]*a[i];return Math.sqrt(q/(t-s));};
const f0=300;
for(const [semis,win] of [[12,2],[-12,2],[7,2],[-5,1],[12,0],[0,2]]){
  const g={nodes:[N('i','input'),N('p','pitch',{semis,win}),N('o','output')],edges:[{a:'i.l',b:'p.in'},{a:'p.out',b:'o.l'}]};
  const x=run(g,3,i=>0.5*Math.sin(2*Math.PI*f0*i/32000));
  const f=freq(x.L,48000,96000), want=f0*Math.pow(2,semis/12);
  console.log(`semis ${String(semis).padStart(3)} win ${win}: measured ${f.toFixed(1)} Hz, expected ${want.toFixed(1)} Hz, rms ${rms(x.L,48000,96000).toFixed(3)} (in .354)  instr ${x.r.ninstr}`);
}
// whammy: ctl sweep
const g=P.PRESETS['Whammy (POT0 = pitch)'];
for(const pv of [0,0.5,1]){const x=run(g,3,i=>0.5*Math.sin(2*Math.PI*f0*i/32000),[pv,0,1]);console.log('whammy pot0',pv,'->',freq(x.L,48000,96000).toFixed(1),'Hz (input 300)');}
// click check: max sample-to-sample jump relative to a clean sine of the output freq
const g2={nodes:[N('i','input'),N('p','pitch',{semis:7,win:2}),N('o','output')],edges:[{a:'i.l',b:'p.in'},{a:'p.out',b:'o.l'}]};
const x=run(g2,3,i=>0.5*Math.sin(2*Math.PI*200*i/32000));let mj=0;for(let i=48001;i<96000;i++)mj=Math.max(mj,Math.abs(x.L[i]-x.L[i-1]));
console.log('max step 200Hz->+7st',mj.toFixed(3),'(clean 300Hz sine max step ≈',(0.5*2*Math.PI*300/32000).toFixed(3),')');
