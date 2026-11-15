const A=require('../src/fv1asm.js'),fs=require('fs');
const r=A.assemble(fs.readFileSync(process.argv[2],'utf8'));
console.log('errors',JSON.stringify(r.errors),'warn',JSON.stringify(r.warnings),'n',r.ninstr);
const ref=fs.readFileSync(process.argv[3]);
const mine=A.wordsToBytes(r.words);
let bad=0;
for(let i=0;i<128;i++){const a=ref.readUInt32BE(i*4)>>>0,b=r.words[i]>>>0;if(a!==b){bad++;console.log('DIFF',i,a.toString(16),b.toString(16));}}
console.log(bad?('MISMATCHES '+bad):'ALL 128 WORDS IDENTICAL');
