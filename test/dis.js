const A=require('../src/fv1asm.js'),P=require('../src/patch.js'),fs=require('fs');
let bad=0,n=0;
function rt(name,asm){const r=A.assemble(asm);if(r.errors.length){console.log(name,'asm err',r.errors[0]);bad++;return;}
 const d=A.disassemble(r.words);const r2=A.assemble(d);
 if(r2.errors.length){console.log(name,'re-asm err',JSON.stringify(r2.errors[0]),'\n',d.split('\n')[r2.errors[0].line-1]);bad++;return;}
 let diff=0;for(let i=0;i<128;i++)if(r.words[i]!==r2.words[i]){diff++;if(diff<4)console.log(name,'word',i,r.words[i].toString(16),r2.words[i].toString(16),'|',d.split('\n')[i+2]);}
 n++;if(diff){bad++;console.log(name,'MISMATCH',diff);}}
for(const f of fs.readdirSync('test/gen').filter(x=>x.endsWith('.spn')))rt(f,fs.readFileSync('test/gen/'+f,'utf8'));
rt('t1',fs.readFileSync('test/t1.spn','utf8'));
// hex round trip
const r=A.assemble(fs.readFileSync('test/t1.spn','utf8'));const img=A.buildBankImage([r.words]);const hex=A.toIntelHex(img);
const back=A.parseIntelHex(hex);const progs=A.splitPrograms(back);console.log('hex roundtrip bytes',back.length,'programs',progs.length,'prog0 same',progs[0].every((w,i)=>w===r.words[i]));
console.log(bad?('FAIL '+bad):('all '+n+' programs round-trip through disassembler'));
