const P=require('../src/patch.js'),A=require('../src/fv1asm.js'),E=require('../src/fv1emu.js');
function run(name,gen,sigf,pots=[0.5,0.5,0.5],N=32000*2){
  const g=P.PRESETS[name]||gen;const r=P.generate(g);if(r.errors.length)throw name+r.errors;
  const a=A.assemble(r.asm);if(a.errors.length)throw a.errors;
  const e=new E(32000);e.load(a.words);const out=[];
  for(let i=0;i<N;i++){e.reg[0x10]=pots[0];e.reg[0x11]=pots[1];e.reg[0x12]=pots[2];const x=sigf(i);out.push(e.step(x,x)[0]);}
  return out;
}
const rms=(a,s,t)=>{let q=0;for(let i=s;i<t;i++)q+=a[i]*a[i];return Math.sqrt(q/(t-s));};
const sine=(f,amp)=>i=>amp*Math.sin(2*Math.PI*f*i/32000);
const db=x=>(20*Math.log10(x+1e-9)).toFixed(1);
// gate: loud then quiet
let o=run('Compressor + Gate',null,i=>(i<32000?0.3:0.005)*Math.sin(2*Math.PI*220*i/32000));
console.log('comp+gate loud rms',db(rms(o,16000,32000)),'quiet(in -46dB) out',db(rms(o,60000,64000)));
// comp ratio: in 0.05 vs 0.4
const o1=run('Compressor + Gate',null,sine(220,0.05)),o2=run('Compressor + Gate',null,sine(220,0.4));
console.log('comp: in 0.05->',db(rms(o1,40000,60000)),' in 0.4->',db(rms(o2,40000,60000)),' (input diff 18.1dB)');
// phaser notches: noise-ish sweep check output rms stable & not blow up
const o3=run('Phaser',null,sine(440,0.3));console.log('phaser rms',db(rms(o3,20000,60000)),'peak',Math.max(...o3.map(Math.abs)).toFixed(3));
// svf wah: BP at different pot positions, tone 1k
for(const p of [0.1,0.5,0.9]){const w=run('Wah (POT0 = pedal)',null,sine(1000,0.3),[p,0,0]);console.log('wah pot',p,'1kHz out',db(rms(w,20000,60000)));}
// auto-wah: loud vs soft 
for(const a of [0.02,0.3]){const w=run('Auto-Wah',null,sine(800,a));console.log('autowah amp',a,'out',db(rms(w,40000,60000)),'in',db(a/Math.SQRT2));}
// metal
for(const a of [0.02,0.1,0.5]){const w=run('Metal (Fromel-style)',null,sine(200,a),[0.5,0.5,0.5]);console.log('metal amp',a,'out rms',db(rms(w,40000,60000)),'peak',Math.max(...w.slice(40000).map(Math.abs)).toFixed(3));}
// metal harmonic content: fft-lite via goertzel
const gz=(x,f,s,t)=>{let re=0,im=0;for(let i=s;i<t;i++){const w=2*Math.PI*f*i/32000;re+=x[i]*Math.cos(w);im+=x[i]*Math.sin(w);}return Math.hypot(re,im)/(t-s)*2;};
const w=run('Metal (Fromel-style)',null,sine(300,0.2));
console.log('metal 300Hz in: fund',db(gz(w,300,40000,60000)),'3rd',db(gz(w,900,40000,60000)),'5th',db(gz(w,1500,40000,60000)),'13th(3.9k)',db(gz(w,3900,40000,60000)),'20th(6k)',db(gz(w,6000,40000,60000)));
for(const p of [0.7,0.75,0.8]){const w=run('Wah (POT0 = pedal)',null,sine(1000,0.3),[p,0,0]);console.log('wah centre test pot',p,db(rms(w,20000,60000)),'in',db(0.3/Math.SQRT2));}
