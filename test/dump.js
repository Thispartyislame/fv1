const P=require('../src/patch.js'),fs=require('fs');
fs.mkdirSync('gen',{recursive:true});
for(const [k,g] of Object.entries(P.PRESETS)){const r=P.generate(g);fs.writeFileSync('gen/'+k.replace(/[^A-Za-z]/g,'_')+'.spn',r.asm);}
// extra stress: every node type in odd configs
const N=(id,type,p)=>({id,type,x:0,y:0,p:Object.assign(P.defaultParams(type),p||{})});
const g2={nodes:[N('i','input'),N('d','drive',{gain:30,bias:0.2}),N('f','filter',{mode:1,order:1,hz:300}),N('c','chorus',{fb:0.5,rate:3}),N('l','lfo'),N('s','smooth'),N('m','mixer'),N('x','xfade'),N('dl','delay',{damp:15000}),N('g','gain',{gain:0.5}),N('o','output'),N('p','pot',{pot:1})],
 edges:[{a:'i.l',b:'d.in'},{a:'d.out',b:'f.in'},{a:'f.out',b:'c.in'},{a:'c.out',b:'m.a'},{a:'i.r',b:'m.b'},{a:'f.out',b:'m.c'},{a:'m.out',b:'dl.in'},{a:'p.out',b:'s.in'},{a:'s.out',b:'dl.time'},{a:'l.out',b:'f.freq'},{a:'dl.out',b:'x.b'},{a:'m.out',b:'x.a'},{a:'l.out',b:'x.ctl'},{a:'x.out',b:'g.in'},{a:'s.out',b:'g.ctl'},{a:'g.out',b:'o.l'},{a:'dl.out',b:'o.r'}]};
const r=P.generate(g2);console.log('stress gen errors',r.errors,'regs',r.stats.regs);fs.writeFileSync('gen/stress.spn',r.asm);
const g3={nodes:[N('i','input'),N('e','env'),N('g','gate'),N('c','comp'),N('s','svf',{mode:3}),N('s2','svf',{mode:0}),N('s3','svf',{mode:2}),N('ph','phaser',{stages:2,fb:-0.5}),N('m','metal',{low:0,mid:0,high:0}),N('o','output')],
 edges:[{a:'i.l',b:'g.in'},{a:'g.out',b:'c.in'},{a:'c.out',b:'s.in'},{a:'i.l',b:'e.in'},{a:'e.out',b:'s.freq'},{a:'s.out',b:'s2.in'},{a:'s2.out',b:'s3.in'},{a:'s3.out',b:'ph.in'},{a:'ph.out',b:'m.in'},{a:'m.out',b:'o.l'}]};
const r3=P.generate(g3);console.log('stress2 errors',r3.errors,'regs',r3.stats.regs,'instr',r3.stats.instr);fs.writeFileSync('gen/stress2.spn',r3.asm);
