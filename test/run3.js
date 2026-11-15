const A=require('../src/fv1asm.js'),E=require('../src/fv1emu.js'),P=require('../src/patch.js');
const g=P.PRESETS['Chorus'];g.nodes[2].p.mix=1;
const gen=P.generate(g);const r=A.assemble(gen.asm);const e=new E(32000);e.load(r.words);
const L=[];for(let i=0;i<96000;i++){e.reg[0x12]=1;const x=(i%2000===0)?0.8:0;L.push(e.step(x,x)[0]);}
// find peak position relative to each impulse in last second
const d=[];for(let k=64000;k<96000;k+=2000){let b=0,bi=0;for(let j=0;j<1999;j++)if(Math.abs(L[k+j])>b){b=Math.abs(L[k+j]);bi=j;}d.push(bi);}
console.log('wet delay (samples) per impulse:',d.join(' '));
console.log('min/max',Math.min(...d),Math.max(...d),' expected center 256 +/-80');
