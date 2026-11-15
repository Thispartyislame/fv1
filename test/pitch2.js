const A=require('../src/fv1asm.js'),E=require('../src/fv1emu.js'),P=require('../src/patch.js');
const N=(id,type,p)=>({id,type,x:0,y:0,p:Object.assign(P.defaultParams(type),p||{})});
function run(g,secs,inFn){const gen=P.generate(g);const r=A.assemble(gen.asm);const e=new E(32000);e.load(r.words);const n=secs*32000,L=new Float64Array(n);for(let i=0;i<n;i++)L[i]=e.step(inFn(i),0)[0];return L;}
function peak(L,s,t){let best=0,bf=0;for(let f=50;f<1500;f+=1){let re=0,im=0;for(let i=s;i<t;i+=2){const w=0.5-0.5*Math.cos(2*Math.PI*(i-s)/(t-s));re+=L[i]*w*Math.cos(2*Math.PI*f*i/32000);im+=L[i]*w*Math.sin(2*Math.PI*f*i/32000);}const m=re*re+im*im;if(m>best){best=m;bf=f;}}return bf;}
for(const [semis,win,cents] of [[12,2,0],[-12,2,0],[7,2,0],[-5,1,0],[12,0,0],[3,3,0],[0,2,25]]){
 const g={nodes:[N('i','input'),N('p','pitch',{semis,win,cents}),N('o','output')],edges:[{a:'i.l',b:'p.in'},{a:'p.out',b:'o.l'}]};
 const L=run(g,3,i=>0.5*Math.sin(2*Math.PI*300*i/32000));
 console.log(`semis ${semis} cents ${cents} win ${win}: spectral peak ${peak(L,40000,92000)} Hz, expected ${(300*Math.pow(2,(semis+cents/100)/12)).toFixed(1)}`);
}
