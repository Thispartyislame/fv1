const P=require('../src/patch.js'),A=require('../src/fv1asm.js'),E=require('../src/fv1emu.js');
function run(g,opt,N){const a=A.assemble(P.generate(g,{optimize:opt}).asm);if(a.errors.length)throw JSON.stringify(a.errors);const e=new E(32000);e.load(a.words);let seed=1;const o=[];
 for(let i=0;i<N;i++){const x=0.25*Math.sin(2*Math.PI*220*i/32000)*(1+Math.sin(i/9000))+0.02*Math.sin(i*1.7);e.reg[0x10]=0.6;e.reg[0x11]=0.4;e.reg[0x12]=0.7;o.push(e.step(x,x)[0]);}return o;}
const extra={};
const N=(id,type,p)=>({id,type,x:0,y:0,p:Object.assign(P.defaultParams(type),p||{})});
extra['ringmod']={nodes:[N('i','input'),N('r','ringmod'),N('o','output')],edges:[{a:'i.l',b:'r.in'},{a:'r.out',b:'o.l'}]};
extra['crush']={nodes:[N('i','input'),N('r','crush'),N('o','output')],edges:[{a:'i.l',b:'r.in'},{a:'r.out',b:'o.l'}]};
for(const shape of [0,1,2,3,4])extra['lfo'+shape]={nodes:[N('i','input'),N('l','lfo',{shape,rate:3}),N('g','gain'),N('o','output')],edges:[{a:'i.l',b:'g.in'},{a:'l.out',b:'g.ctl'},{a:'g.out',b:'o.l'}]};
extra['potshape']={nodes:[N('i','input'),N('p','pot',{pot:0,curve:3,lo:0.2,hi:0.9}),N('g','gain'),N('o','output')],edges:[{a:'i.l',b:'g.in'},{a:'p.out',b:'g.ctl'},{a:'g.out',b:'o.l'}]};
const all=Object.assign({},P.PRESETS,extra);
for(const [k,g] of Object.entries(all)){const a=run(g,true,48000),b=run(g,false,48000);let d=0,pk=0;for(let i=0;i<a.length;i++){d=Math.max(d,Math.abs(a[i]-b[i]));pk=Math.max(pk,Math.abs(a[i]));}console.log(k.padEnd(24),'maxdiff',d.toExponential(1),'peak',pk.toFixed(3));}
