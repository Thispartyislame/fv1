const { chromium } = require('playwright');
(async()=>{
  const b=await chromium.launch({args:['--no-sandbox']});
  const ctx=await b.newContext({viewport:{width:1500,height:900},acceptDownloads:true});
  const p=await ctx.newPage();
  const logs=[];p.on('console',m=>logs.push(m.type()+': '+m.text()));p.on('pageerror',e=>logs.push('PAGEERROR: '+e.message));
  // mock Arduino + 24LC32 following the sketch protocol
  await p.addInitScript(()=>{
    const eeprom=new Uint8Array(4096).fill(0xff);window.__eeprom=eeprom;
    let ctrl,pending=[];
    const readable=new ReadableStream({start(c){ctrl=c;}});
    function reply(bytes){ctrl.enqueue(Uint8Array.from(bytes));}
    function handle(){
      while(pending.length){
        const c=pending[0];
        if(c===63){pending.shift();reply([...'FV1PROG1'].map(x=>x.charCodeAt(0)).concat([89]));}
        else if(c===80){ if(pending.length<19)return; const d=pending.splice(0,19);const a=(d[1]<<8)|d[2];eeprom.set(d.slice(3),a);reply([75]);}
        else if(c===82){ if(pending.length<4)return; const d=pending.splice(0,4);const a=(d[1]<<8)|d[2];reply([...eeprom.slice(a,a+d[3]),75]);}
        else pending.shift();
      }
    }
    const writable=new WritableStream({write(chunk){pending.push(...chunk);handle();}});
    const port={readable,writable,open:async()=>{},close:async()=>{}};
    Object.defineProperty(navigator,'serial',{value:{requestPort:async()=>port},configurable:true});
  });
  await p.goto('file://'+require('path').resolve(__dirname,'../../fv1-studio.html'));
  await p.click('.tabs button[data-tab="chip"]');
  // store Echo in slot 1, Plate Reverb in slot 3
  await p.click('#slots .slot:nth-child(1) .acts button:nth-child(1)');
  await p.selectOption('#preset','Plate Reverb'); await p.waitForTimeout(200);
  await p.click('#slots .slot:nth-child(3) .acts button:nth-child(1)');
  await p.click('#btnSerial'); await p.waitForTimeout(2600);
  console.log(await p.textContent('#log'));
  await p.click('#btnWrite'); await p.waitForTimeout(4000);
  console.log(await p.textContent('#log'));
  // compare chip image with exported bin
  const [dl]=await Promise.all([p.waitForEvent('download'),p.click('#btnBin')]);
  const path=await dl.path(); const fs=require('fs'); const bin=fs.readFileSync(path);
  const chip=await p.evaluate(()=>Array.from(window.__eeprom));
  let diff=0;for(let i=0;i<4096;i++)if(bin[i]!==chip[i])diff++;
  console.log('bin size',bin.length,'diff vs mock chip',diff);
  // hex export checks
  const [dh]=await Promise.all([p.waitForEvent('download'),p.click('#btnHex')]);
  const hex=fs.readFileSync(await dh.path(),'utf8').trim().split('\n');
  console.log('hex lines',hex.length,'first',hex[0],'last',hex[hex.length-1]);
  // verify hex parses back to the same bytes + checksums valid
  const out=new Uint8Array(4096);let okc=true;
  for(const l of hex){const n=parseInt(l.substr(1,2),16),a=parseInt(l.substr(3,4),16),t=parseInt(l.substr(7,2),16);let s=0;for(let i=1;i<l.length;i+=2)s+=parseInt(l.substr(i,2),16);if((s&255)!==0)okc=false;if(t===0)for(let j=0;j<n;j++)out[a+j]=parseInt(l.substr(9+2*j,2),16);}
  let d2=0;for(let i=0;i<4096;i++)if(out[i]!==bin[i])d2++;console.log('hex checksums ok',okc,'hex vs bin diff',d2);
  // slot layout: slot1 first word, empty slot2 is NOP words
  console.log('slot0 word0',Buffer.from(bin.slice(0,4)).toString('hex'),'slot1 word0 (empty)',Buffer.from(bin.slice(512,516)).toString('hex'));
  // hand-edit mode with an intentionally broken line then fix
  await p.click('.tabs button[data-tab="code"]');
  await p.click('#btnHand'); await p.fill('#code','rdax adcl,1.0\nfoo bar\nwrax dacl,0'); await p.waitForTimeout(200);
  console.log('hand-edit error shown:',(await p.textContent('#errs')).trim());
  await p.fill('#code','rdax adcl,0.5\nwrax dacl,1.0\nwrax dacr,0'); await p.waitForTimeout(200);
  console.log('hand-edit ok instr:',await p.textContent('#sI'),'err:',JSON.stringify(await p.textContent('#errs')));
  await p.click('#btnHand'); await p.waitForTimeout(200);
  console.log('back to graph instr:',await p.textContent('#sI'));
  // cable drag test: disconnect + reconnect via mouse
  await p.selectOption('#preset','Echo'); await p.waitForTimeout(200);
  const before=await p.$$eval('#cables path:not(.hit)',n=>n.length);
  const src=await p.$('.node[data-id="n3"] .dot[data-dir="in"][data-port="a"]'), sb=await src.boundingBox();
  await p.mouse.move(sb.x+6,sb.y+6);await p.mouse.down();await p.mouse.move(sb.x+80,sb.y+200,{steps:5});await p.mouse.up();
  const mid=await p.$$eval('#cables path:not(.hit)',n=>n.length);
  console.log('cables before/after detaching one input:',before,mid);
  console.log(logs.join('\n')||'(no console output)');
  await p.screenshot({path:__dirname+'/shot4.png'});
  await b.close();
})();
