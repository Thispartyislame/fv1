const P=require('../../src/patch.js'),A=require('../../src/fv1asm.js'),E=require('../../src/fv1emu.js');
const N=(id,type,p)=>({id,type,x:0,y:0,p:Object.assign(P.defaultParams(type),p||{})});
function run(g,f,n){const r=P.generate(g);const a=A.assemble(r.asm);if(a.errors.length)throw JSON.stringify(a.errors)+r.asm;const e=new E(32000);e.load(a.words);const o=[];for(let i=0;i<n;i++)o.push(e.step(f(i),f(i))[0]);return o;}
const gz=(x,f,s,t)=>{let re=0,im=0;for(let i=s;i<t;i++){const w=2*Math.PI*f*i/32000;re+=x[i]*Math.cos(w);im+=x[i]*Math.sin(w);}return Math.hypot(re,im)/(t-s)*2;};
let o=run({nodes:[N('i','input'),N('r','ringmod',{hz:300,mix:1}),N('o','output')],edges:[{a:'i.l',b:'r.in'},{a:'r.out',b:'o.l'}]},i=>0.3*Math.sin(2*Math.PI*1000*i/32000),32000);
console.log('ring 1k x 300: 700',gz(o,700,8000,32000).toFixed(3),'1300',gz(o,1300,8000,32000).toFixed(3),'1000',gz(o,1000,8000,32000).toFixed(3),'300',gz(o,300,8000,32000).toFixed(3),'peak',Math.max(...o.map(Math.abs)).toFixed(3));
o=run({nodes:[N('i','input'),N('r','crush',{bits:3,pre:1,tone:15000}),N('o','output')],edges:[{a:'i.l',b:'r.in'},{a:'r.out',b:'o.l'}]},i=>0.5*Math.sin(2*Math.PI*100*i/32000),3200);
console.log('crush 3 bit distinct levels',new Set(o.slice(400).map(v=>v.toFixed(2))).size);
for(const sh of [0,1,2,3,4]){const w=run({nodes:[N('i','input'),N('l','lfo',{shape:sh,rate:4}),N('g','gain'),N('o','output')],edges:[{a:'i.l',b:'g.in'},{a:'l.out',b:'g.ctl'},{a:'g.out',b:'o.l'}]},()=>0.8,16000);
 const ds=[];for(let i=0;i<8000;i+=500)ds.push((w[i]/0.8).toFixed(2));console.log('lfo shape',sh,ds.join(' '));}
