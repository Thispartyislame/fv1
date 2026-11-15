const P=require('../../src/patch.js'),A=require('../../src/fv1asm.js'),E=require('../../src/fv1emu.js');
function run(g,amp,N=64000){const a=A.assemble(P.generate(g).asm);const e=new E(32000);e.load(a.words);let q=0,qi=0,c=0;
 for(let i=0;i<N;i++){const t=i/32000;const env=Math.exp(-((t*2)%1)*3);const x=amp*env*(Math.sin(2*Math.PI*196*t)+0.5*Math.sin(2*Math.PI*392*t+1)+0.3*Math.sin(2*Math.PI*588*t));
  e.reg[0x10]=0.5;e.reg[0x11]=0.5;e.reg[0x12]=0.5;const y=e.step(x,x)[0];if(i>16000){q+=y*y;qi+=x*x;c++;}}
 return 10*Math.log10((q/c+1e-18)/(qi/c+1e-18));}
console.log('preset'.padEnd(26),'gain dB at input peak 0.02 / 0.08 / 0.3 (guitar-like decaying notes)');
for(const [k,g] of Object.entries(P.PRESETS))console.log(k.padEnd(26),[0.02,0.08,0.3].map(a=>run(g,a).toFixed(1).padStart(7)).join(' '));
