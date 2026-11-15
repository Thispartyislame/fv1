const A=require('../src/fv1asm.js'),E=require('../src/fv1emu.js'),P=require('../src/patch.js');
function mk(nodes,edges){return {nodes,edges};}
const N=(id,type,x,y,p)=>({id,type,x,y,p:Object.assign(P.defaultParams(type),p||{})});
function run(g,secs,inFn,pots){const gen=P.generate(g);if(gen.errors.length)throw new Error(gen.errors[0]);const r=A.assemble(gen.asm);if(r.errors.length)throw new Error(JSON.stringify(r.errors)+gen.asm);
 const e=new E(32000);e.load(r.words);const n=secs*32000,L=new Float64Array(n),R=new Float64Array(n);
 for(let i=0;i<n;i++){(pots||[]).forEach((v,k)=>e.reg[0x10+k]=v);const x=inFn(i);const o=e.step(x,x);L[i]=o[0];R[i]=o[1];}return {L,R,r};}
const rms=(a,s,t)=>{let q=0;for(let i=s;i<t;i++)q+=a[i]*a[i];return Math.sqrt(q/(t-s));};
let seed=1;const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296*2-1;};
// reverb wet-only level vs noise input
let g=mk([N('i','input'),N('r','reverb',0,0,{}),N('o','output')],[{a:'i.l',b:'r.in'},{a:'r.l',b:'o.l'},{a:'r.r',b:'o.r'}]);
let x=run(g,6,i=>i<96000?0.3*rnd():0);
console.log('reverb wet rms (input .173):',rms(x.L,32000,96000).toFixed(3),'R',rms(x.R,32000,96000).toFixed(3),'peak',x.L.reduce((m,v)=>Math.max(m,Math.abs(v)),0).toFixed(2));
console.log('reverb tail rms 1s after stop:',rms(x.L,96000+3200,96000+35200).toFixed(4),' 2s after:',rms(x.L,96000+64000,96000+96000).toFixed(5));
// max decay stability
g.nodes[1].p.time=0.93; x=run(g,20,i=>i<64000?0.9*rnd():0);
console.log('max decay: peak',x.L.reduce((m,v)=>Math.max(m,Math.abs(v)),0).toFixed(2),'tail rms @19s',rms(x.L,19*32000,20*32000).toFixed(5));
// tremolo depth
g=P.PRESETS['Tremolo'];x=run(g,3,i=>0.4*Math.sin(2*Math.PI*440*i/32000));
let mn=9,mxx=0;for(let k=32000;k<96000;k+=160){const v=rms(x.L,k,k+160);mn=Math.min(mn,v);mxx=Math.max(mxx,v);}
console.log('tremolo env min/max rms',mn.toFixed(3),mxx.toFixed(3),'(input rms .283)');
// echo: delay time with pot0=1.0 and 0.5
for(const pv of [0.25,0.5,1.0]){g=P.PRESETS['Echo'];x=run(g,2,i=>i===100?0.8:0,[pv,0.0,1.0]);
 let best=0,bi=0;for(let i=1000;i<64000;i++)if(Math.abs(x.L[i])>best){best=Math.abs(x.L[i]);bi=i;}
 console.log('echo pot0',pv,'first echo at',((bi-100)/32).toFixed(1),'ms expected≈',(Math.max(32,600*32*pv)/32).toFixed(1));}
// chorus: output has wet; check sample-delay spread
g=P.PRESETS['Chorus'];g.nodes[2].p.mix=1;x=run(g,4,i=>(i%4000===0?0.8:0),[0,0,1]);
let pk=[];for(let i=0;i<4000;i++)if(Math.abs(x.L[8000+i])>0.2)pk.push(i);console.log('chorus peaks at offsets',pk.slice(0,6));
// overdrive clipping
g=P.PRESETS['Overdrive'];x=run(g,1,i=>0.5*Math.sin(2*Math.PI*220*i/32000),[0,1,0]);
console.log('overdrive out peak',x.L.reduce((m,v)=>Math.max(m,Math.abs(v)),0).toFixed(3),'rms',rms(x.L,8000,32000).toFixed(3));
