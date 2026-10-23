/* EbookForge Web v0.3: chapter extraction, 1bit XTC rendering. */
(function(g){
'use strict';
const te=new TextEncoder(), dec=new TextDecoder('utf-8',{fatal:true});
function filename(s){return String(s||'ebook').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,70);}
function utf(s,n){const a=new Uint8Array(n);let p=0;for(const c of String(s||'')){const b=te.encode(c);if(p+b.length>=n)break;a.set(b,p);p+=b.length;}return a;}
function fromText(text,title='電子書籍',md=false){
 const mark=md?/^#{1,3}\s+(.+)/:/^\s*(第[一二三四五六七八九十百千0-9０-９]+[章話部編節].*|序章|終章|プロローグ|エピローグ)\s*$/;
 const chapters=[];let ch={title:'本文',text:''};
 for(const line of String(text).replace(/\r\n?/g,'\n').split('\n')){
  const m=line.match(mark);if(m){if(ch.text.trim())chapters.push(ch);ch={title:(m[1]||'章').slice(0,90),text:''};}
  else ch.text+=line.replace(/\*\*([^*]+)\*\*/g,'$1')+'\n';
 }
 if(ch.text.trim())chapters.push(ch);
 if(!chapters.length)throw Error('本文が空です');
 if(chapters.length>1500)throw Error('章数が多すぎます');
 return {title,author:'',chapters,source:md?'md':'txt'};
}
function nodes(root,name){return Array.from(root.getElementsByTagName('*')).filter(x=>x.localName===name);}
function xml(s){const d=new DOMParser().parseFromString(s,'application/xml');if(nodes(d,'parsererror').length)throw Error('EPUBのXML構文が不正です');return d;}
function join(base,href){let a=[];for(const p of (base+decodeURIComponent(href.split('#')[0])).split('/')){
 if(p==='..'){if(!a.length)throw Error('不正なEPUBパス');a.pop();}else if(p&&p!=='.')a.push(p);}return a.join('/');}
function extract(n){
 if(n.nodeType===3)return n.nodeValue||'';if(n.nodeType!==1)return '';
 const tag=n.localName;
 if(['head','style','script','svg','nav'].includes(tag))return '';
 if(tag==='ruby'){const rt=nodes(n,'rt').map(x=>x.textContent).join('').trim();
 const base=Array.from(n.childNodes).filter(x=>!['rt','rp','rtc'].includes(x.localName)).map(extract).join('');
 return rt?'｜'+base+'《'+rt+'》':base;}
 if(['rt','rp','rtc'].includes(tag))return '';
 if(tag==='br')return '\n';
 if(tag==='img')return '\n［挿絵：この形式では省略］\n';
 const text=Array.from(n.childNodes).map(extract).join('');
 return /^(p|h1|h2|h3|h4|div|section|article|li)$/.test(tag)?'\n'+text+'\n':text;
}
async function fromEpub(data,progress=()=>{}){
 const z=g.EbookForgeEpub;if(!z)throw Error('EPUB読込モジュールがありません');
 const entries=z.readZIP(data),lookup=new Map(entries.map(e=>[e.name,e]));
 const container=lookup.get('META-INF/container.xml');if(!container)throw Error('EPUB container.xmlがありません');
 const c=xml(dec.decode(await z.unpack(container))),root=nodes(c,'rootfile')[0],opfPath=root?.getAttribute('full-path');
 if(!opfPath||!lookup.has(opfPath))throw Error('EPUB OPFがありません');
 const opf=xml(dec.decode(await z.unpack(lookup.get(opfPath))));
 const folder=opfPath.includes('/')?opfPath.slice(0,opfPath.lastIndexOf('/')+1):'';
 const items=new Map(nodes(opf,'item').map(n=>[n.getAttribute('id'),n]));
 const spine=nodes(opf,'itemref').map(n=>n.getAttribute('idref')),chapters=[];
 for(let i=0;i<spine.length;i++){
  const item=items.get(spine[i]);if(!item||!/xhtml|html/.test(item.getAttribute('media-type')||''))continue;
  const p=join(folder,item.getAttribute('href')||''),file=lookup.get(p);if(!file)throw Error('EPUB本文が見つかりません: '+p);
  const doc=xml(dec.decode(await z.unpack(file))),body=nodes(doc,'body')[0];if(!body)continue;
  const h=nodes(body,'h1')[0]||nodes(body,'h2')[0]||nodes(body,'h3')[0];
  const text=extract(body).replace(/\n{3,}/g,'\n\n').trim();
  if(text)chapters.push({title:(h?.textContent?.trim()||`第${i+1}章`).slice(0,90),text});
  if(chapters.length>1500)throw Error('EPUBの章が多すぎます');
  progress(i+1,spine.length);if(i%8===0)await new Promise(ok=>setTimeout(ok,0));
 }
 if(!chapters.length)throw Error('EPUB本文を抽出できませんでした');
 return {title:nodes(opf,'title')[0]?.textContent?.trim()||'電子書籍',
  author:nodes(opf,'creator')[0]?.textContent?.trim()||'',chapters,source:'epub'};
}
function tokenize(s){
 const out=[],re=/｜([^《\n]{1,60})《([^》\n]{1,60})》/g;let pos=0,m;
 function add(t){for(const x of t.match(/\n|[A-Za-z0-9]{1,20}|[\s\S]/gu)||[])out.push(x==='\n'?{t:'nl'}:{t:/^[A-Za-z0-9]{2,20}$/.test(x)?'ascii':'char',s:x});}
 while((m=re.exec(s))){add(s.slice(pos,m.index));out.push({t:'ruby',s:m[1],ruby:m[2]});pos=re.lastIndex;}add(s.slice(pos));return out;
}
function drawV(ctx,t,x,y,step,size){
 ctx.fillStyle='#000';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`${size}px "Hiragino Mincho ProN","Yu Mincho",serif`;
 if(t.t==='ruby'){
  const base=Array.from(t.s);base.forEach((c,i)=>drawV(ctx,{t:'char',s:c},x,y+i*step,step,size));
  const chars=Array.from(t.ruby),fs=Math.max(9,Math.floor(size*.46)),d=Math.min(step*.6,base.length*step/Math.max(chars.length,1));
  ctx.font=`${fs}px serif`;const origin=y+(base.length*step-chars.length*d)/2;
  chars.forEach((c,i)=>ctx.fillText(c,x+size*.68,origin+(i+.5)*d));return;
 }
 if(t.t==='ascii'&&t.s.length<=2){ctx.font=`${Math.round(size*.74)}px sans-serif`;ctx.fillText(t.s,x,y);return;}
 if(/[A-Za-z0-9]/.test(t.s)){ctx.save();ctx.translate(x,y);ctx.rotate(Math.PI/2);ctx.fillText(t.s,0,0);ctx.restore();return;}
 const forms={'ー':'｜','「':'﹁','」':'﹂','『':'﹃','』':'﹄','（':'︵','）':'︶'};
 ctx.fillText(forms[t.s]||t.s,x+('、。'.includes(t.s)?size*.2:0),y-('、。'.includes(t.s)?size*.2:0));
}
function pack(ctx,W,H){
 const pix=ctx.getImageData(0,0,W,H).data,stride=Math.ceil(W/8),data=new Uint8Array(stride*H);data.fill(255);
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
 const p=(y*W+x)*4;if(pix[p]*.299+pix[p+1]*.587+pix[p+2]*.114<128)data[y*stride+(x>>3)]&=~(128>>(x&7));}
 return data;
}
function decodePage(b,W,H,canvas,xtch=false){
 canvas.width=W;canvas.height=H;const ctx=canvas.getContext('2d'),img=ctx.createImageData(W,H);
 const stride=Math.ceil(W/8),colStride=Math.ceil(H/8),planeSize=W*colStride;
 if(xtch && b.length!==planeSize*2)throw Error('XTCHページの長さが不正です');
 if(!xtch && b.length!==stride*H)throw Error('XTCページの長さが不正です');
 const palette=[255,96,160,0];
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
   let lum;
   if(xtch){const offset=(W-1-x)*colStride+(y>>3),bit=128>>(y&7);
     const idx=((b[offset]&bit)?2:0)|((b[planeSize+offset]&bit)?1:0);lum=palette[idx];
   }else{lum=(b[y*stride+(x>>3)]&(128>>(x&7)))?255:0;}
   const p=(y*W+x)*4;img.data[p]=img.data[p+1]=img.data[p+2]=lum;img.data[p+3]=255;
 }ctx.putImageData(img,0,0);
}
async function renderBook(book,opt={},progress=()=>{}){
 const W=528,H=792,v=opt.vertical!==false,fs=Number(opt.font)||22,m=Number(opt.margin)||30,spacing=Number(opt.spacing)||1.45;
 if(fs<14||fs>40||m<12||m>90||spacing<1.05||spacing>2.3)throw Error('組版設定が不正です');
 const step=Math.ceil(fs*spacing),line=Math.ceil(fs*(spacing+.15)),rows=Math.floor((H-2*m)/step),cols=Math.floor((W-2*m)/line);
 const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);
 let pages=[],chapters=[],r=0,c=0,ink=false;
 function reset(){ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);ctx.fillStyle='#000';r=0;c=0;ink=false;}
 function save(force=false){if(ink||force){pages.push(pack(ctx,W,H));if(pages.length>900)throw Error('900ページを超えています');}reset();}
 function next(){if(v){c++;r=0;if(c>=cols)save();}else{r++;c=0;if(r>=rows)save();}}
 const selected=book.chapters.filter(ch=>ch.selected!==false);if(!selected.length)throw Error('章を選んでください');
 const close=new Set(Array.from('、。，）」』】ぁぃぅぇぉっゃゅょ')),open=new Set(Array.from('（「『【'));
 for(let j=0;j<selected.length;j++){
  if(ink)save();const start=pages.length,ch=selected[j];chapters.push({title:ch.title,page:start});
  const ts=tokenize(ch.text);
  for(let i=0;i<ts.length;i++){
   const list=ts[i].t==='ascii'&&ts[i].s.length>2?Array.from(ts[i].s).map(s=>({t:'char',s})):[ts[i]];
   for(const t of list){
    if(t.t==='nl'){next();continue;}
    const cells=t.t==='ruby'?Math.max(1,Array.from(t.s).length):1;
    if(v){
     if(cells>rows)throw Error('ルビの対象語が長すぎます');
     if(r+cells>rows||(r+cells>=rows&&(close.has(ts[i+1]?.s)||open.has(t.s))))next();
     if(c>=cols)save();
     drawV(ctx,t,W-m-fs/2-c*line,m+fs/2+r*step,step,fs);r+=cells;ink=true;
    }else{
     const value=t.t==='ruby'?t.s+'（'+t.ruby+'）':t.s;
     ctx.font=`${fs}px "Hiragino Mincho ProN",serif`;ctx.textAlign='left';ctx.textBaseline='top';
     const width=ctx.measureText(value).width;if(c+width>W-2*m&&c>0)next();
     ctx.fillText(value,m+c,m+r*step);c+=width;ink=true;
    }
   }
   if(i%500===0&&i)await new Promise(ok=>setTimeout(ok,0));
  }
  if(ink||pages.length===start)save(true);
  progress(j+1,selected.length);await new Promise(ok=>setTimeout(ok,0));
 }
 return {pages,chapters,width:W,height:H};
}
function buildXtcWithChapters(pages,chapters,title,author,vertical=true,format='xtc'){
 const W=528,H=792,N=pages.length,HEAD=56,META=256,CH=96,ENTRY=16,PH=22;
 if(!['xtc','xtch'].includes(format))throw Error('出力形式が不正です');
 const color=format==='xtch',PS=color?W*Math.ceil(H/8)*2:Math.ceil(W/8)*H;
 if(!N||N>65535||pages.some(p=>p.length!==PS))throw Error('ページデータが不正です');
 const ch=chapters.filter(c=>c.page>=0&&c.page<N),chOff=HEAD+META,tbl=chOff+ch.length*CH,dat=tbl+N*ENTRY,per=PH+PS,total=dat+N*per;
 if(total>110*1048576)throw Error('出力は110MBまでです');
 const b=new Uint8Array(total),dv=new DataView(b.buffer);b.set(color?[88,84,67,72]:[88,84,67,0]);b[4]=1;dv.setUint16(6,N,true);
 b[8]=vertical?1:0;b[9]=1;b[11]=ch.length?1:0;dv.setUint32(12,1,true);
 dv.setBigUint64(16,BigInt(HEAD),true);dv.setBigUint64(24,BigInt(tbl),true);dv.setBigUint64(32,BigInt(dat),true);
 if(ch.length)dv.setUint32(48,chOff,true);
 b.set(utf(title,128),HEAD);b.set(utf(author,64),HEAD+128);b.set(utf('EbookForge Web',32),HEAD+192);
 b.set(utf('ja',16),HEAD+224);dv.setUint16(HEAD+246,ch.length,true);
 ch.forEach((c,i)=>{const o=chOff+i*CH,s=c.page+1,e=i+1<ch.length?ch[i+1].page:N;
 b.set(utf(c.title,80),o);dv.setUint16(o+80,s,true);dv.setUint16(o+82,Math.max(s,e),true);});
 for(let i=0;i<N;i++){const t=tbl+i*ENTRY,o=dat+i*per;
 dv.setBigUint64(t,BigInt(o),true);dv.setUint32(t+8,per,true);dv.setUint16(t+12,W,true);dv.setUint16(t+14,H,true);
 b.set(color?[88,84,72,0]:[88,84,71,0],o);dv.setUint16(o+4,W,true);dv.setUint16(o+6,H,true);dv.setUint32(o+10,PS,true);
 b.set(md5(pages[i]).slice(0,8),o+14);b.set(pages[i],o+PH);}return b;
}
g.EbookForgeBook={fromText,fromEpub,renderBook,buildXtcWithChapters,decodePage,safeName:filename,pack};
})(typeof window!=='undefined'?window:globalThis);
