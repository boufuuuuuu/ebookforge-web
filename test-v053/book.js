/* EbookForge Web v0.8.1: chapter extraction, Kakuyomu/Narou notation, 1bit XTC rendering. */
(function(g){
'use strict';
const te=new TextEncoder(), dec=new TextDecoder('utf-8',{fatal:true});
function filename(s){return String(s||'ebook').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,70);}
function utf(s,n){const a=new Uint8Array(n);let p=0;for(const c of String(s||'')){const b=te.encode(c);if(p+b.length>=n)break;a.set(b,p);p+=b.length;}return a;}
// v0.7.1: 小説家になろうの話のページをコピーして貼った本文を整理する（サイトからの自動取得はしない）。
// 「1/98」のような話数表示の行と「作者：」の行が両方あるときだけ働く。話数表示の次の行を話タイトル（章）にし、
// 毎回くり返される作品名・作者の行と、画面の操作用の文言（その行だけのもの）を捨てる。ルビは 漢字(かんじ) の形なのでかっこルビを使う。
const NAROU_COUNTER=/^\s*([0-9０-９]{1,5})\s*[\/／]\s*([0-9０-９]{1,5})\s*$/;
const NAROU_AUTHOR=/^\s*作者[：:]\s*(.{1,60}?)\s*$/;
const NAROU_CHROME=new Set(['↓','↑ページトップへ','小説家になろう','小説を読もう！','ランキング','ログイン','作品情報','感想','レビュー','ブックマークに追加','ブックマーク','表示調整','目次','次へ','前へ','<< 前へ','次へ >>','＜＜ 前へ','次へ ＞＞','前へ >>','評価をするには ログイン してください。','感想を書く','Tweet','LINEで送る','コピー','ブックマーク機能を使うには ログイン してください。','―　新着の感想　―','感想一覧','感想を書く場合は ログイン してください。','作者マイページ','誤字報告','情報提供','+注意+','作品検索','しおりを挟む','しおり','ポイントを入れて作者を応援しましょう！','いいねをする','いいね','ページトップへ']);
function fromNarouCopy(text){
 const lines=String(text).replace(/\r\n?/g,'\n').split('\n');
 if(!lines.some(l=>NAROU_COUNTER.test(l))||!lines.some(l=>NAROU_AUTHOR.test(l)))return null;
 // 作品名＝「作者：」の直前の空でない行のうち、最も多いもの
 const cand=new Map();let author='';
 lines.forEach((l,i)=>{const m=l.match(NAROU_AUTHOR);if(!m)return;author=author||m[1].trim();
  for(let j=i-1;j>=0;j--)if(lines[j].trim()){const t=lines[j].trim();cand.set(t,(cand.get(t)||0)+1);break;}});
 const workTitle=[...cand].sort((a,b)=>b[1]-a[1])[0]?.[0]||'';
 const chapters=[];let ch=null,skipHead=false;
 for(let i=0;i<lines.length;i++){
  const raw=lines[i],t=raw.trim();
  if(NAROU_CHROME.has(t))continue;
  if(NAROU_COUNTER.test(raw)){                       // 話数表示 → 次の空でない行が話タイトル
   let j=i+1;while(j<lines.length&&(!lines[j].trim()||NAROU_CHROME.has(lines[j].trim())))j++;
   if(j<lines.length){if(ch&&ch.text.trim())chapters.push(ch);ch={title:lines[j].trim().slice(0,90),text:''};i=j;skipHead=true;}
   continue;
  }
  if(!ch)continue;                                   // 最初の話数表示より前（画面の上部）は捨てる
  if(skipHead&&(!t||t===workTitle||NAROU_AUTHOR.test(raw)))continue;   // 話タイトル直後の作品名・作者の行
  skipHead=false;
  if(NAROU_AUTHOR.test(raw)&&t.length<=40)continue;
  ch.text+=raw+'\n';
 }
 if(ch&&ch.text.trim())chapters.push(ch);
 if(!chapters.length)return null;
 for(const c of chapters)c.text=c.text.replace(/\n{4,}/g,'\n\n\n').replace(/^\n+/,'');
 return{title:workTitle||'電子書籍',author,chapters,source:'narou',parenRuby:true};
}
function fromText(text,title='電子書籍',md=false){
 if(!md){const n=fromNarouCopy(text);if(n)return n;}
 // v0.6.7: 話タイトル（第N話・閑話・幕間・番外編・Episode N 等）も章にする。文の途中の「第1話で…」は章にしない
 const mark=md?/^#{1,3}\s+(.+)/:/^\s*(第[一二三四五六七八九十百千〇0-9０-９]+[章話部編節幕回].{0,40}|(?:序章|終章|プロローグ|エピローグ|閑話|幕間|間章|断章|番外編|外伝|あとがき)(?:[\s　:：・].{0,40})?|(?:Episode|EP|Ep|ep)\.?\s*[0-9０-９]+.{0,40}|[0-9０-９]{1,4}話(?:[\s　:：].{0,40})?)\s*$/;
 // カクヨムの画面からコピーしたときに混ざる操作用の文言（その行だけのもの）は捨てる
 const CHROME=/^\s*(応援する|応援コメント|次のエピソード|前のエピソード|★で称える|レビューを書く|コメントを書く)\s*$/;
 const chapters=[];let ch={title:'本文',text:''};
 for(const line of String(text).replace(/\r\n?/g,'\n').split('\n')){
  if(CHROME.test(line))continue;
  const m=!/[。、」』]\s*$/.test(line)||md?line.match(mark):null;if(m){if(ch.text.trim())chapters.push(ch);ch={title:(m[1]||'章').slice(0,90),text:''};}
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
// v0.6.7: カクヨム・小説家になろうの記法に対応
//  ｜漢字《かんじ》 / |漢字《かんじ》 / 漢字《かんじ》（直前の漢字の並び）＝ルビ、《《強調》》＝傍点、|《 ＝「《」そのもの
//  PAREN_RUBY のとき、漢字の直後の（かなだけ）もルビにする（カクヨムの画面からコピーした本文は 漢字（かんじ） の形になるため）
const KANJI='\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF々〆〇ヶ';
const RUBY_RE=new RegExp('[|｜]《|《《([^《》\\n]{1,50})》》|[|｜]([^《|｜\\n]{1,20})《([^《》\\n]{1,30})》|(['+KANJI+']{1,20})《([^《》\\n]{1,30})》','g');
const PAREN_RE=new RegExp('(['+KANJI+']{1,20})[（(]([ぁ-ゖァ-ヺー]{1,20})[）)]','g');
let PAREN_RUBY=false;
function tokenize(s){
 const out=[];
 function add(t){for(const x of t.match(/\n|[A-Za-z0-9]{1,20}|[\s\S]/gu)||[])out.push(x==='\n'?{t:'nl'}:{t:/^[A-Za-z0-9]{2,20}$/.test(x)?'ascii':'char',s:x});}
 function plain(t){
  if(!PAREN_RUBY){add(t);return;}
  let p=0,m;PAREN_RE.lastIndex=0;
  while((m=PAREN_RE.exec(t))){add(t.slice(p,m.index));out.push({t:'ruby',s:m[1],ruby:m[2]});p=PAREN_RE.lastIndex;}
  add(t.slice(p));
 }
 let pos=0,m;RUBY_RE.lastIndex=0;
 while((m=RUBY_RE.exec(s))){
  plain(s.slice(pos,m.index));pos=RUBY_RE.lastIndex;
  if(m[0].length===2&&m[0][1]==='《'){out.push({t:'char',s:'《'});continue;}
  if(m[1]!==undefined){for(const c of Array.from(m[1]))out.push(c==='\n'?{t:'nl'}:{t:'char',s:c,em:true});continue;}
  if(m[2]!==undefined){out.push({t:'ruby',s:m[2],ruby:m[3]});continue;}
  out.push({t:'ruby',s:m[4],ruby:m[5]});
 }
 plain(s.slice(pos));return out;
}
// v0.5.9: 書体・太さ・白黒化のしきい値を renderBook のオプションで変更可能に（既定は従来どおり明朝・128）
const MINCHO='"Hiragino Mincho ProN","Yu Mincho",serif';
let FAM=MINCHO,WT='',THR=128;
const ROT=new Set(Array.from('ー－―‐‑–—～〜…‥＝=｜'));
function drawV(ctx,t,x,y,step,size){
 ctx.fillStyle='#000';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`${WT}${size}px ${FAM}`;
 if(t.t==='ruby'){
  const base=Array.from(t.s);base.forEach((c,i)=>drawV(ctx,{t:'char',s:c},x,y+i*step,step,size));
  // v0.8.1: ルビは本文の約半分（最低11px）の太めのゴシックで描く（細い明朝の小さい字は白黒2値でつぶれるため）
  const chars=Array.from(t.ruby),fs=Math.max(11,Math.round(size*.5)),d=Math.min(fs*1.02,Math.max(fs*.8,base.length*step/Math.max(chars.length,1)));
  ctx.font=`600 ${fs}px "Hiragino Sans","Yu Gothic","Noto Sans CJK JP",sans-serif`;const origin=y+(base.length*step-chars.length*d)/2;
  chars.forEach((c,i)=>{const cy=origin+(i+.5)*d;
   if(ROT.has(c)){ctx.save();ctx.translate(x+size*.74,cy);ctx.rotate(Math.PI/2);ctx.fillText(c,0,0);ctx.restore();}
   else ctx.fillText(c,x+size*.74,cy);});return;
 }
 // 1〜2桁の英数字は立てたまま（縦中横）。長い英単語を1字ずつに分けたもの（rot）だけ横倒しにする
 if(!t.rot&&/^[A-Za-z0-9]{1,2}$/.test(t.s)){ctx.font=`${Math.round(size*.74)}px sans-serif`;ctx.fillText(t.s,x,y);return;}
 if(/[A-Za-z0-9]/.test(t.s)){ctx.save();ctx.translate(x,y);ctx.rotate(Math.PI/2);ctx.fillText(t.s,0,0);ctx.restore();return;}
 // v0.8.1: 長音「ー」・ダッシュ・波線・三点リーダーは、記号に置き換えず字そのものを90°回す（本文と同じ太さで、縦書き本来の形になる）
 if(ROT.has(t.s)){ctx.save();ctx.translate(x,y);ctx.rotate(Math.PI/2);ctx.fillText(t.s,0,0);ctx.restore();if(t.em){ctx.beginPath();ctx.arc(x+size*.68,y,Math.max(1.6,size*.09),0,Math.PI*2);ctx.fill();}return;}
 const forms={'「':'﹁','」':'﹂','『':'﹃','』':'﹄','（':'︵','）':'︶','《':'︽','》':'︾','［':'﹇','］':'﹈','【':'︻','】':'︼','〈':'︿','〉':'﹀'};
 ctx.fillText(forms[t.s]||t.s,x+('、。'.includes(t.s)?size*.2:0),y-('、。'.includes(t.s)?size*.2:0));
 if(t.em){ctx.beginPath();ctx.arc(x+size*.68,y,Math.max(1.6,size*.09),0,Math.PI*2);ctx.fill();}   // 傍点（右側の黒丸）
}
// v0.8.1: 2倍の大きさで描いたページを、2×2画素の平均の濃さで1bitにする（細い線が白に飛ばない）
function pack2x(ctx,W,H,thr){
 const pix=ctx.getImageData(0,0,W*2,H*2).data,W2=W*2,stride=Math.ceil(W/8),data=new Uint8Array(stride*H);data.fill(255);
 const lum=i=>pix[i]*.299+pix[i+1]*.587+pix[i+2]*.114;
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const a=((y*2)*W2+x*2)*4,b=a+W2*4;
  if((lum(a)+lum(a+4)+lum(b)+lum(b+4))/4<thr)data[y*stride+(x>>3)]&=~(128>>(x&7));
 }
 return data;
}
function pack(ctx,W,H){
 const pix=ctx.getImageData(0,0,W,H).data,stride=Math.ceil(W/8),data=new Uint8Array(stride*H);data.fill(255);
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
 const p=(y*W+x)*4;if(pix[p]*.299+pix[p+1]*.587+pix[p+2]*.114<THR)data[y*stride+(x>>3)]&=~(128>>(x&7));}
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
 FAM=opt.fontFamily||MINCHO;WT=opt.fontWeight?opt.fontWeight+' ':'';THR=Number(opt.inkThreshold)||128;PAREN_RUBY=!!opt.parenRuby;
 try{return await renderBookInner(book,opt,progress);}finally{FAM=MINCHO;WT='';THR=128;PAREN_RUBY=false;}
}
async function renderBookInner(book,opt={},progress=()=>{}){
 const W=528,H=792,v=opt.vertical!==false,fs=Number(opt.font)||22,m=Number(opt.margin)||30,spacing=Number(opt.spacing)||1.45;
 if(fs<14||fs>40||m<12||m>90||spacing<1.05||spacing>2.3)throw Error('組版設定が不正です');
 const step=Math.ceil(fs*spacing),line=Math.ceil(fs*(spacing+.15)),rows=Math.floor((H-2*m)/step),cols=Math.floor((W-2*m)/line);
 const canvas=document.createElement('canvas');canvas.width=W*2;canvas.height=H*2;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.setTransform(2,0,0,2,0,0);ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);
 const thr2=Number(opt.inkThreshold)?Math.min(200,Number(opt.inkThreshold)+25):170;      // 2倍描画の平均の濃さで判定するしきい値
 let pages=[],chapters=[],r=0,c=0,ink=false;
 function reset(){ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);ctx.fillStyle='#000';r=0;c=0;ink=false;}
 function save(force=false){if(ink||force){pages.push(pack2x(ctx,W,H,thr2));if(pages.length>900)throw Error('900ページを超えています');}reset();}
 function next(){if(v){c++;r=0;if(c>=cols)save();}else{r++;c=0;if(r>=rows)save();}}
 const selected=book.chapters.filter(ch=>ch.selected!==false);if(!selected.length)throw Error('章を選んでください');
 const close=new Set(Array.from('、。，）」』】ぁぃぅぇぉっゃゅょ')),open=new Set(Array.from('（「『【'));
 for(let j=0;j<selected.length;j++){
  if(ink)save();const start=pages.length,ch=selected[j];chapters.push({title:ch.title,page:start});
  // v0.6.0: 本文中の図の印（\uE000番号）で区切り、図は用意済みのページ（opt.figures[番号]）として挿し込む
  const parts=String(ch.text).split(/\uE000(\d+)\n?/);
  for(let q=0;q<parts.length;q++){
   if(q%2===1){
    const fig=opt.figures&&opt.figures[Number(parts[q])];
    if(fig){if(ink)save();pages.push(fig);if(pages.length>900)throw Error('900ページを超えています');reset();}
    continue;
   }
   await layoutText(parts[q]);
  }
  if(ink||pages.length===start)save(true);
  progress(j+1,selected.length);await new Promise(ok=>setTimeout(ok,0));
 }
 return {pages,chapters,width:W,height:H};
 async function layoutText(text){
  const ts=tokenize(text);
  for(let i=0;i<ts.length;i++){
   const list=ts[i].t==='ascii'&&(ts[i].s.length>2||/[a-z]/.test(ts[i].s))?Array.from(ts[i].s).map(s=>({t:'char',s,rot:true})):[ts[i]];
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
     ctx.font=`${WT}${fs}px ${FAM}`;ctx.textAlign='left';ctx.textBaseline='top';ctx.fillStyle='#000';
     const width=ctx.measureText(value).width;if(c+width>W-2*m&&c>0)next();
     ctx.fillText(value,m+c,m+r*step);
     if(t.em){ctx.beginPath();ctx.arc(m+c+width/2,m+r*step-fs*.14,Math.max(1.6,fs*.09),0,Math.PI*2);ctx.fill();}   // 傍点（上側の黒丸）
     c+=width;ink=true;
    }
   }
   if(i%500===0&&i)await new Promise(ok=>setTimeout(ok,0));
  }
 }
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
g.EbookForgeBook={fromText,fromNarouCopy,fromEpub,renderBook,buildXtcWithChapters,decodePage,safeName:filename,pack,tokenize,
 _setParenRuby:v=>{PAREN_RUBY=!!v;}};
})(typeof window!=='undefined'?window:globalThis);
