/* EbookForge Web 0.6.1: PDF and RAR/CBR adapters.
 * Files are processed inside the browser. Third-party render/extractor engines
 * are fetched only when the matching file type is used.
 * PDF.js: Apache 2.0; node-unrar-js: MIT / UnRAR upstream restrictions apply.
 */
(function(g){
'use strict';
const MAX_PDF_SIZE=35*1048576,MAX_PDF_PAGES=120;
const MAX_RAR_SIZE=40*1048576,MAX_RAR_EXTRACT=125*1048576,MAX_RAR_ITEMS=180;
const IMAGE_EXT=/\.(png|jpe?g|webp)$/i;
const PDF_SCRIPT='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDF_WORKER='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
// v0.5.3: 日本語PDFの白紙化対策。PDF.js は埋め込みでない日本語フォント（UniJIS-UCS2-H 等の定義済みCMap）を
// 読むのに CMap ファイルが必要。未指定だと文字の描画もテキスト抽出も空になり、白紙ページになる。
// jsDelivr の /npm/ は npm 公開物をそのまま配信（pdfjs-dist@3.11.174 には cmaps/ と standard_fonts/ が同梱）。
// リポジトリに cmaps/ フォルダを置いた場合はそちらを優先（CDN 非依存）。
const PDF_CMAPS_CDN='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/';
const PDF_FONTS_CDN='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/standard_fonts/';
const BLANK_GUARD=3;  // 最初に描画したページがこの枚数連続で白紙なら、描画失敗として中止
const UNRAR_MODULE='https://esm.sh/node-unrar-js@2.0.2/esm/index.esm.js?bundle';
const UNRAR_MODULE_FALLBACK='https://cdn.jsdelivr.net/npm/node-unrar-js@2.0.2/+esm';
const UNRAR_WASM='https://cdn.jsdelivr.net/npm/node-unrar-js@2.0.2/esm/js/unrar.wasm';
let pdfPromise=null,unrarPromise=null;
const testDeps={};
// iPhone の「ファイル」経由だとファイル名が %E5%88%86… のまま渡ることがあるため表示用に戻す
function displayName(name){
 // v0.5.8: 連続する %XX ごとに個別に戻す（名前の一部に戻せない % があっても、残りは日本語に戻す）。
 // 二重にエンコードされた名前（%25E5…）にも対応するため最大2回まで繰り返す。
 let n=String(name||'');
 for(let k=0;k<2&&/%[0-9A-Fa-f]{2}/.test(n);k++){
  const next=n.replace(/(?:%[0-9A-Fa-f]{2})+/g,m=>{try{return decodeURIComponent(m);}catch(_){return m;}});
  if(next===n)break;n=next;
 }
 return n;
}
function fileType(name){
 const n=String(name||'').toLowerCase();
 return /\.pdf$/.test(n)?'pdf':/\.(?:rar|cbr)$/.test(n)?'rar':null;
}
function err(reason){throw Error(reason);}
function acceptedImage(name){
 return IMAGE_EXT.test(name)&&!/(^|\/)__MACOSX(?:\/|$)/i.test(name)&&!/(^|\/)\./.test(name);
}
async function loadPDF(){
 if(testDeps.pdf)return testDeps.pdf;
 if(g.pdfjsLib){g.pdfjsLib.GlobalWorkerOptions.workerSrc=PDF_WORKER;return g.pdfjsLib;}
 if(pdfPromise)return pdfPromise;
 pdfPromise=new Promise((resolve,reject)=>{
  if(!g.document)return reject(Error('PDFエンジンを読み込めません'));
  const script=document.createElement('script');
  script.src=PDF_SCRIPT;script.async=true;script.crossOrigin='anonymous';
  script.onload=()=>{
   const lib=g.pdfjsLib||g['pdfjs-dist/build/pdf'];
   if(!lib)return reject(Error('PDF.jsが利用できません'));
   lib.GlobalWorkerOptions.workerSrc=PDF_WORKER;resolve(lib);
  };
  script.onerror=()=>reject(Error('PDF.jsをダウンロードできません。オンライン状態で再試行してください'));
  document.head.appendChild(script);
 }).catch(e=>{pdfPromise=null;throw e;});
 return pdfPromise;
}
function canvasToBlob(canvas,type='image/png'){
 return new Promise((resolve,reject)=>{
  canvas.toBlob(blob=>blob?resolve(blob):reject(Error('ページ画像の生成に失敗しました')),type);
 });
}
let pdfAssetPromise=null;
async function pdfAssets(){
 if(testDeps.pdfAssets)return testDeps.pdfAssets;
 if(!pdfAssetPromise)pdfAssetPromise=(async()=>{
  let local=false;
  try{
   if(g.location&&/^https?:$/.test(g.location.protocol)){
    const r=await fetch('cmaps/UniJIS-UCS2-H.bcmap',{method:'HEAD',cache:'no-store'});
    local=r.ok;
   }
  }catch(_){}
  return local?{cMapUrl:'cmaps/',standardFontDataUrl:'standard_fonts/'}
              :{cMapUrl:PDF_CMAPS_CDN,standardFontDataUrl:PDF_FONTS_CDN};
 })();
 return pdfAssetPromise;
}
function canvasHasInk(ctx,w,h){
 if(typeof ctx.getImageData!=='function')return true; // test doubles without pixel APIs
 const {data}=ctx.getImageData(0,0,w,h);
 for(let k=0;k<data.length;k+=4)if(data[k]<235||data[k+1]<235||data[k+2]<235)return true;
 return false;
}
function analysisScale(page){
 const base=page.getViewport({scale:1});
 const scale=Math.min(2,1600/Math.max(base.width,base.height),Math.sqrt(3.2e6/(base.width*base.height)));
 if(!Number.isFinite(scale)||scale<=0)err('PDFのページサイズが不正です');
 return scale;
}
async function fromPDF(file){
 if(file.size>MAX_PDF_SIZE)err('PDFは35MB以内にしてください');
 const lib=await loadPDF();
 let doc;
 try{
  const bytes=new Uint8Array(await file.arrayBuffer());
  const assets=await pdfAssets();
  const task=lib.getDocument({data:bytes,stopAtErrors:true,isEvalSupported:false,
    cMapUrl:assets.cMapUrl,cMapPacked:true,standardFontDataUrl:assets.standardFontDataUrl});
  doc=await task.promise;
  if(!Number.isSafeInteger(doc.numPages)||doc.numPages<1)err('PDFにページがありません');
  if(doc.numPages>MAX_PDF_PAGES)err(`PDFは${MAX_PDF_PAGES}ページ以内にしてください。分割してお試しください`);
  let closed=false,rendered=0,blankRun=0,sawInk=false;
  const sources=Array.from({length:doc.numPages},(_,i)=>({
   name:`${displayName(file.name).replace(/\.pdf$/i,'')}/${String(i+1).padStart(5,'0')}.png`,
   archive:displayName(file.name).replace(/\.pdf$/i,''),
   kind:'pdf',uniformGroup:'pdf:'+file.name+':'+file.size,
   entryName:`${String(i+1).padStart(5,'0')}.png`,
   // v0.5.6: 解析用画像（open）の座標 r を、最終解像度で PDF から直接描画する。
   // 大きく描いた画像をブラウザで縮小すると細い文字が欠けるため、倍率 k をかけた大きさで
   // ベクターから描き直す（文字の輪郭がその解像度で最も鮮明になる）。
   renderRegion:async(r,k)=>{
    if(closed)err('PDFは既に閉じられました');
    const page=await doc.getPage(i+1);
    const c=document.createElement('canvas');
    try{
     const s0=analysisScale(page),viewport=page.getViewport({scale:s0*k});
     c.width=Math.max(1,Math.round(r.w*k));c.height=Math.max(1,Math.round(r.h*k));
     const cx=c.getContext('2d');cx.fillStyle='#fff';cx.fillRect(0,0,c.width,c.height);
     await page.render({canvasContext:cx,viewport,background:'rgb(255,255,255)',
       transform:[1,0,0,1,-r.x*k,-r.y*k]}).promise;
     return c;
    }catch(e){c.width=0;c.height=0;throw e;}
    finally{if(page.cleanup)page.cleanup();}
   },
   open:async()=>{
    if(closed)err('PDFは既に閉じられました');
    const page=await doc.getPage(i+1);
    let canvas;
    try{
     const scale=analysisScale(page);
     const viewport=page.getViewport({scale});
     canvas=document.createElement('canvas');
     canvas.width=Math.max(1,Math.round(viewport.width));
     canvas.height=Math.max(1,Math.round(viewport.height));
     const ctx=canvas.getContext('2d');
     if(!ctx)err('Canvasを使用できません');
     ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
     await page.render({canvasContext:ctx,viewport,background:'rgb(255,255,255)'}).promise;
     rendered++;
     let ink=canvasHasInk(ctx,canvas.width,canvas.height);
     if(!ink){
      // フォント描画だけが失敗し、文字情報は取れる場合の救済（横書きのみ）。
      // 縦書きを fillText で描くと全行が1行に重なって潰れ、しかも「インクあり」と判定されて
      // 壊れたページが保存されるため、縦書きの文字がある場合は救済せずエラーにする。
      const text=await page.getTextContent();
      const items=(text.items||[]).filter(x=>typeof x.str==='string'&&x.str.trim());
      const vertical=items.some(x=>text.styles?.[x.fontName]?.vertical);
      if(items.length&&vertical)
       err(`PDF ${i+1}ページ：縦書きの文字を描画できません（フォント未対応）。空白・崩れたXTCは保存しません`);
      if(items.length){
       const mul=(a,b)=>[
        a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],
        a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],
        a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]
       ];
       ctx.fillStyle='#111';
       for(const item of items){
        if(!Array.isArray(item.transform)||item.transform.length!==6)continue;
        const m=mul(viewport.transform,item.transform);
        if(!Number.isFinite(Math.hypot(m[2],m[3]))||Math.hypot(m[2],m[3])<0.5)continue;
        ctx.save();ctx.transform(...m);ctx.scale(1,-1);ctx.font='1px sans-serif';
        ctx.fillText(item.str,0,0);ctx.restore();
       }
       ink=canvasHasInk(ctx,canvas.width,canvas.height);
       if(!ink)err(`PDF ${i+1}ページの文字を描画できません。空白のXTCは保存しません`);
      }
     }
     // 白紙ページ自体は本にもある。ただし描画開始から連続して白紙なら描画失敗とみなして止める
     if(ink){sawInk=true;blankRun=0;}
     else if(!sawInk&&++blankRun>=BLANK_GUARD)
      err(`PDFの最初に描画した${BLANK_GUARD}ページがすべて白紙です。フォントや画像を描画できていない可能性があるため中止しました（白紙のXTCは保存しません）`);
     return await canvasToBlob(canvas);
    }finally{
     if(canvas){canvas.width=0;canvas.height=0;}
     if(page.cleanup)page.cleanup();
    }
   }
  }));
  return{sources,close:async()=>{if(closed)return;closed=true;await doc.destroy();}};
 }catch(e){
  if(doc){try{await doc.destroy();}catch(_){}}
  if(e?.name==='PasswordException')throw Error('パスワード付きPDFは未対応です');
  throw e;
 }
}
async function loadUnrar(){
 if(testDeps.unrar)return testDeps.unrar;
 if(unrarPromise)return unrarPromise;
 unrarPromise=(async()=>{
  let mod;
  try{mod=await import(UNRAR_MODULE);}
  catch(firstError){
   try{mod=await import(UNRAR_MODULE_FALLBACK);}
   catch(secondError){throw Error('RAR展開エンジンを読み込めません。オンライン状態で再試行してください: '+secondError.message);}
  }
  if(typeof mod.createExtractorFromData!=='function')err('RARエンジンに必要な機能がありません');
  let response;
  try{response=await fetch(UNRAR_WASM);}
  catch(e){throw Error('RAR展開用WASMを取得できません: '+e.message);}
  if(!response.ok)err('RAR展開用WASMの取得に失敗しました: HTTP '+response.status);
  const wasm=await response.arrayBuffer();
  if(!wasm.byteLength||wasm.byteLength>20*1048576)err('RAR展開用WASMのサイズが不正です');
  return{createExtractorFromData:mod.createExtractorFromData,wasmBinary:wasm};
 })().catch(e=>{unrarPromise=null;throw e;});
 return unrarPromise;
}
function rarHeaderSize(h){
 const size=Number(h.unpSize);
 if(!Number.isSafeInteger(size)||size<0)err('RAR内の画像サイズを確認できません: '+h.name);
 return size;
}
async function fromRAR(file){
 if(file.size>MAX_RAR_SIZE)err('RAR/CBRは40MB以内にしてください');
 const lib=await loadUnrar();
 // Do not send archive bytes to an API. The wasm decoder executes locally.
 const extractor=await lib.createExtractorFromData({
  data:await file.arrayBuffer(),wasmBinary:lib.wasmBinary
 });
 const listing=extractor.getFileList();
 if(listing.arcHeader?.flags?.volume)err('分割RAR（マルチボリューム）は未対応です');
 if(listing.arcHeader?.flags?.headerEncrypted)err('暗号化RARは未対応です');
 const headers=[...listing.fileHeaders];
 const names=[],sizes=new Map();
 let total=0;
 for(const h of headers){
  if(h.flags?.directory || !acceptedImage(h.name))continue;
  if(h.flags?.encrypted)err('暗号化RAR/CBRは未対応です');
  const size=rarHeaderSize(h);
  if(size>35*1048576)err('RAR内に35MBを超える画像があります');
  total+=size;
  if(total>MAX_RAR_EXTRACT)err('RARの展開後画像が125MBを超えています');
  if(sizes.has(h.name))err('RAR内に重複する画像名があります: '+h.name);
  names.push(h.name);sizes.set(h.name,size);
  if(names.length>MAX_RAR_ITEMS)err(`RAR内の画像は${MAX_RAR_ITEMS}枚以内です`);
 }
 if(!names.length)err('RAR/CBRに対応画像がありません');
 const wanted=new Set(names);
 // Extract selected images once, then release each buffer after its page is rendered.
 const data=new Map();let actual=0;
 const files=extractor.extract({files:h=>wanted.has(h.name)&&!h.flags?.directory}).files;
 for(const f of files){
  const name=f.fileHeader.name;
  if(!wanted.has(name))continue;
  if(!(f.extraction instanceof Uint8Array))err('RARの画像を展開できません: '+name);
  const bytes=f.extraction;
  if(bytes.length>35*1048576)err('RARから展開した画像が35MBを超えました');
  actual+=bytes.length;
  if(actual>MAX_RAR_EXTRACT)err('RARの展開後画像が125MBを超えました');
  data.set(name,Uint8Array.from(bytes));
 }
 if(data.size!==names.length)err('RAR内の一部画像を読み込めませんでした');
 const archive=displayName(file.name).replace(/\.(rar|cbr)$/i,'');
 const sources=names.map(name=>({
  name:archive+'/'+name,archive,entryName:name,
  open:async()=>{
   const bytes=data.get(name);
   if(!bytes)err('RARの画像をもう一度取得してください: '+name);
   // Discard the original byte array once the image Blob has taken ownership.
   const blob=new Blob([bytes],{type:/\.png$/i.test(name)?'image/png':
      /\.webp$/i.test(name)?'image/webp':'image/jpeg'});
   data.delete(name);
   return blob;
  }
 }));
 return{sources,close:async()=>data.clear()};
}
// v0.5.7: PDF の文字情報を取り出して、本文テキスト（章＝大きい文字の見出し）に組み直す。
// 文字の並びは PDF に書かれた順（作成ソフトの論理順。HTML→PDF なら記述順）を使う。
// 行の区切り：PDF.js の改行フラグ、または行位置（横書きは y、縦書きは x）が文字の大きさの半分以上変わったとき。
// v0.5.9: 取り出した文字の整形
// - 部首・互換用の漢字（⽇ U+2F47 など。PDFの文字情報でよく混入する）を通常の漢字へ（NFKC は該当文字だけに適用）
// - 字間を広げて配置された文字の間の空白を詰める（日本語どうし／1文字ずつ空白で区切られた英字）
const CJK='\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef';
function cleanText(s){
 s=s.replace(/[\u2e80-\u2fdf\uf900-\ufaff]/g,c=>c.normalize('NFKC'));
 s=s.replace(new RegExp(`([${CJK}])[ \\u00a0]+(?=[${CJK}])`,'g'),'$1');
 const tok=s.split(' ');
 if(tok.length>=4&&tok.filter(t=>t.length===1).length>=tok.length*0.6)s=tok.join('');
 else s=s.replace(/(?:^|(?<= ))((?:[A-Za-z0-9'] ){3,}[A-Za-z0-9'])(?= |$)/g,m=>m.replace(/ /g,''));
 return s.replace(/ {2,}/g,' ').trim();
}
function pdfPageLines(tc){
 const styles=tc.styles||{},lines=[];let cur=null;
 const flush=()=>{if(cur){cur.str=cleanText(cur.str);if(cur.str)lines.push(cur);}cur=null;};
 for(const it of tc.items||[]){
  if(typeof it.str!=='string')continue;
  const t=it.transform||[1,0,0,1,0,0],size=Math.hypot(t[2],t[3])||it.height||10;
  const vertical=!!styles[it.fontName]?.vertical,pos=vertical?t[4]:t[5];
  // 行の進む方向の始点・終点（横書き=x、縦書き=上から下へ）。折り返しの判定に使う
  const a0=vertical?-t[5]:t[4],a1=a0+(vertical?(it.height||0):(it.width||0));
  if(it.str!==''){
   if(cur&&(cur.vertical!==vertical||Math.abs(pos-cur.pos)>Math.max(size,cur.size)*0.5))flush();
   if(!cur)cur={str:'',size,pos,vertical,chars:0,a0,a1};
   const ascii=/[A-Za-z0-9]$/.test(cur.str)&&/^[A-Za-z0-9]/.test(it.str);
   cur.str+=(ascii?' ':'')+it.str;cur.size=Math.max(cur.size,size);cur.chars+=it.str.length;
   cur.a0=Math.min(cur.a0,a0);cur.a1=Math.max(cur.a1,a1);
  }
  if(it.hasEOL)flush();
 }
 flush();
 return lines;
}
function linesToBook(pages,title){
 const all=pages.flat().filter(l=>!l.fig),hasFig=pages.flat().some(l=>l.fig!==undefined);
 if(!all.length&&!hasFig)err('このPDFには文字情報がありません（スキャン画像のPDFは組み直せません）。「画像として変換」を使ってください');
 // 本文の文字サイズ＝文字数で重み付けした中央値
 const sizes=[];for(const l of all)for(let k=0;k<Math.min(l.chars,200);k++)sizes.push(l.size);
 sizes.sort((a,b)=>a-b);const body=sizes[Math.floor(sizes.length/2)]||10;
 const vertical=all.filter(l=>l.vertical).reduce((n,l)=>n+l.chars,0)*2>all.reduce((n,l)=>n+l.chars,0);
 const chapters=[];let ch={title:'本文',text:'',pageMark:0};
 const END=/[。．.！？!?」』）)：:]$/;
 // 大見出しのしきい値：見出し候補（本文の1.35倍以上）の中で大きい側。候補が1種類ならそれを大見出しとする
 // 大見出し＝本文の1.6倍以上で、文書中に3回以上（またはページ数の15%以上）現れる大きさのうち最大のもの。
 // 表紙だけに1回出る巨大な文字ではなく、各ページの見出し（「何ができるツール？」等）を章にする。
 const cnt=new Map();
 for(const l of all)if(l.size>=body*1.35){const k=Math.round(l.size*2)/2;cnt.set(k,(cnt.get(k)||0)+1);}
 const need=Math.max(3,Math.ceil(pages.length*0.15));
 const rep=[...cnt].filter(([k,n])=>k>=body*1.6&&n>=need).map(([k])=>k).sort((a,b)=>b-a);
 const anyH=[...cnt.keys()].sort((a,b)=>b-a);
 const h1=rep.length?rep[0]-0.25:(anyH[0]?anyH[0]-0.25:Infinity);
 let pageNo=0;
 for(const lines of pages){
  pageNo++;
  if(ch.pageMark!==pageNo&&ch.text&&!/\n$/.test(ch.text))ch.text+='\n';
  // 段落の復元：同じ大きさ・同じ書き出し位置で続く行をひとまとまり（ブロック）とし、
  // ブロックの右端（縦書きは下端）近くまで届いている行は「折り返し」とみなして次の行とつなぐ
  const blocks=[];
  for(const l of lines){
   const b=blocks[blocks.length-1],p=b&&b[b.length-1];
   if(l.fig!==undefined||p?.fig!==undefined){blocks.push([l]);continue;}
   if(p&&!(l.size>=body*1.35)&&!(p.size>=body*1.35)&&Math.abs(l.size-p.size)<p.size*0.15&&
      Math.abs(l.a0-p.a0)<=p.size*1.2&&Math.abs(l.pos-p.pos)<=p.size*2.4)b.push(l);
   else blocks.push([l]);
  }
  for(const b of blocks){
   if(b[0].fig!==undefined){ch.text+='\uE000'+b[0].fig+'\n';ch.pageMark=pageNo;continue;}
   const edge=Math.max(...b.map(l=>l.a1));
   let para='';
   b.forEach((l,k)=>{
    const s=l.str.replace(/\s+/g,' ').trim();if(!s)return;
    if(l.size>=body*1.35&&s.length<=60){
     // 見出し直前の短いラベル行（「はじめに」「01・説明」等）は見出しの下へ移す
     const rows=ch.text.replace(/\n+$/,'').split('\n'),last=rows[rows.length-1]||'';
     const label=last&&last.length<=16&&!/^[■●]/.test(last)&&ch.pageMark===pageNo?last:'';
     if(label)ch.text=rows.slice(0,-1).join('\n')+'\n';
     if(l.size>=h1&&!(rep.length&&l.size>rep[0]+0.75&&(cnt.get(Math.round(l.size*2)/2)||0)<need)){  // 大見出し → 章
      if(ch.text.trim())chapters.push(ch);
      ch={title:s.slice(0,90),text:'■ '+s+'\n'+(label?label+'\n':'')+'\n',pageMark:pageNo};
     }else{                                             // 中見出し → 本文中の見出し行
      ch.text+=(ch.text.trim()?'\n':'')+'● '+s+'\n'+(label?label+'\n':'');ch.pageMark=pageNo;
     }
     return;
    }
    const ascii=/[A-Za-z0-9]$/.test(para)&&/^[A-Za-z0-9]/.test(s);
    para+=(para&&ascii?' ':'')+s;
    const wrapped=k<b.length-1&&l.a1>=edge-l.size*1.5&&!END.test(s);
    if(!wrapped){ch.text+=para+'\n';para='';ch.pageMark=pageNo;}
   });
   if(para)ch.text+=para+'\n';
  }
  ch.text+='\n';                                       // ページの区切りは空行
 }
 if(ch.text.trim())chapters.push(ch);
 if(!chapters.length)err('PDFから本文を取り出せませんでした');
 if(chapters.length>1&&chapters[0].title==='本文')chapters[0].title='表紙・はじめ';
 return{title,author:'',chapters,source:'pdf',vertical};
}
// v0.6.1: ページ内の図の位置を、描画命令から求める。
//  (1) ラスター画像：画像描画命令の単位正方形を変換行列（CTM）で写す（v0.6.0 と同じ）
//  (2) 線・図形で描かれた図（ベクター図。HTML/CSS や SVG から作った PDF の概念図・チャート・表など）：
//      パス描画命令の外接矩形を集め、近いものを束ね、「図らしい」束だけを図とする。
//      除外：文字を囲む枠・背景（カード・注記ボックス・濃い背景の文字ボックス）、単独の罫線・飾り線、小さいアイコン。
//  (3) 図の範囲に重なる文字（図のラベル）は図に含め、本文からは外す（二重に出さない）。
const mulM=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],
 a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
const rUnion=(A,B)=>[Math.min(A[0],B[0]),Math.min(A[1],B[1]),Math.max(A[2],B[2]),Math.max(A[3],B[3])];
const rHit=(A,B,m=0)=>A[0]-m<=B[2]&&B[0]-m<=A[2]&&A[1]-m<=B[3]&&B[1]-m<=A[3];
const rArea=r=>Math.max(0,r[2]-r[0])*Math.max(0,r[3]-r[1]);
// 文字行の外接矩形（PDF座標・y上向き）
function lineRect(l){
 if(l.vertical)return[l.pos-l.size*0.5,-l.a1,l.pos+l.size*0.5,-l.a0];
 return[l.a0,l.pos-l.size*0.25,l.a1,l.pos+l.size*0.9];
}
// パスの形：rect=軸に平行な直線と矩形だけ、closed=閉じた図形、segs=線分数
function pathShape(OPS,ops,co){
 let k=0,rect=true,closed=false,segs=0,px=null,py=null,sx=null,sy=null;const pts=[];
 for(const op of ops){
  if(op===OPS.rectangle){const x=co[k],y=co[k+1],w=co[k+2],h=co[k+3];k+=4;pts.push([x,y],[x+w,y+h]);closed=true;segs+=4;}
  else if(op===OPS.moveTo){px=sx=co[k];py=sy=co[k+1];k+=2;pts.push([px,py]);}
  else if(op===OPS.lineTo){const x=co[k],y=co[k+1];k+=2;if(px!==null&&Math.abs(x-px)>0.01&&Math.abs(y-py)>0.01)rect=false;
   pts.push([x,y]);px=x;py=y;segs++;if(sx!==null&&Math.abs(x-sx)<0.01&&Math.abs(y-sy)<0.01)closed=true;}
  else if(op===OPS.curveTo){for(let j=0;j<3;j++)pts.push([co[k+2*j],co[k+2*j+1]]);px=co[k+4];py=co[k+5];k+=6;rect=false;segs++;}
  else if(op===OPS.curveTo2||op===OPS.curveTo3){pts.push([co[k],co[k+1]],[co[k+2],co[k+3]]);px=co[k+2];py=co[k+3];k+=4;rect=false;segs++;}
  else if(op===OPS.closePath){closed=true;if(px!==null&&sx!==null&&Math.abs(px-sx)>0.01&&Math.abs(py-sy)>0.01)rect=false;px=sx;py=sy;}
 }
 return{pts,rect,closed,segs};
}
async function pageFigureRects(lib,page,lines=[],debug=null){
 const OPS=lib.OPS,ol=await page.getOperatorList(),vb=page.view;  // view=[x0,y0,x1,y1]
 const pw=vb[2]-vb[0],ph=vb[3]-vb[1],PA=pw*ph,hasText=lines.length>0;
 const tRects=lines.map(lineRect);
 // 文字を抱えているか：文字行の半分以上が入る、または箱の3割以上を文字が占める（横並びの箱は1行に結合されるため）
 const containsText=r=>{const ra=rArea(r);return tRects.some(t=>{
  const ix=Math.min(r[2],t[2])-Math.max(r[0],t[0]),iy=Math.min(r[3],t[3])-Math.max(r[1],t[1]);
  if(ix<=0||iy<=0)return false;
  const th=t[3]-t[1];if(r[2]-r[0]<th||iy<th*0.8)return false;   // 文字1字も入らない細い線・小さな記号は箱ではない
  const ia=ix*iy;return ia>=rArea(t)*0.5||ia>=ra*0.3;});};
 const mapR=(ctm,pts)=>{let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const[x,y]of pts){const X=ctm[0]*x+ctm[2]*y+ctm[4],Y=ctm[1]*x+ctm[3]*y+ctm[5];
   if(X<x0)x0=X;if(X>x1)x1=X;if(Y<y0)y0=Y;if(Y>y1)y1=Y;}
  return[Math.max(vb[0],x0),Math.max(vb[1],y0),Math.min(vb[2],x1),Math.min(vb[3],y1)];};
 let ctm=[1,0,0,1,0,0],pending=null;const stack=[],images=[],shapes=[];
 const imgOps=new Set([OPS.paintImageXObject,OPS.paintInlineImageXObject,OPS.paintImageMaskXObject,OPS.paintJpegXObject].filter(x=>x!==undefined));
 const strokeOps=new Set([OPS.stroke,OPS.closeStroke].filter(x=>x!==undefined));
 const fillOps=new Set([OPS.fill,OPS.eoFill,OPS.fillStroke,OPS.eoFillStroke,OPS.closeFillStroke,OPS.closeEOFillStroke].filter(x=>x!==undefined));
 for(let i=0;i<ol.fnArray.length;i++){
  const fn=ol.fnArray[i],args=ol.argsArray[i];
  if(fn===OPS.save)stack.push(ctm);
  else if(fn===OPS.restore)ctm=stack.pop()||[1,0,0,1,0,0];
  else if(fn===OPS.transform)ctm=mulM(ctm,args);
  else if(fn===OPS.paintFormXObjectBegin){stack.push(ctm);if(Array.isArray(args?.[0])&&args[0].length===6)ctm=mulM(ctm,args[0]);}
  else if(fn===OPS.paintFormXObjectEnd)ctm=stack.pop()||[1,0,0,1,0,0];
  else if(imgOps.has(fn))images.push(mapR(ctm,[[0,0],[1,0],[0,1],[1,1]]));
  else if(fn===OPS.constructPath){const sh=pathShape(OPS,args[0],args[1]);if(sh.pts.length)pending={...sh,ctm};}
  else if(strokeOps.has(fn)||fillOps.has(fn)){
   if(pending){
    const p=pending,r=mapR(p.ctm,p.pts),fill=fillOps.has(fn);
    // 回転・傾いた変換では「軸に平行」の判定を保てないので形のある図形として扱う
    const axis=Math.abs(p.ctm[1])<1e-6&&Math.abs(p.ctm[2])<1e-6||Math.abs(p.ctm[0])<1e-6&&Math.abs(p.ctm[3])<1e-6;
    if(r[2]>=r[0]&&r[3]>=r[1])shapes.push({r,fill,rect:p.rect&&axis,closed:p.closed,segs:p.segs});
   }
   pending=null;
  }else if(fn===OPS.endPath)pending=null;
 }
 // --- (1) ラスター画像（v0.6.0 と同じ判定）
 const figs=images.filter(r=>{const w=r[2]-r[0],h=r[3]-r[1];
  if(w<=0||h<=0||w*h<PA*0.03||w<pw*0.12||h<ph*0.05)return false;
  if(hasText&&w*h>=PA*0.85)return false;
  return true;}).map(r=>({r,raster:true}));
 // --- (2) ベクター図
 const thin=Math.max(1.5,Math.min(pw,ph)*0.004);
 const boxes=[],parts=[];
 for(const s of shapes){
  const w=s.r[2]-s.r[0],h=s.r[3]-s.r[1],a=w*h;
  if(a>=PA*0.5){continue;}                                   // ページ背景
  const holds=containsText(s.r);
  // 文字を囲む塗り・閉じた枠（カード・注記・濃い背景の文字ボックス）、または大きな矩形の塗り＝背景
  if((s.fill||s.closed)&&holds){boxes.push(s.r);continue;}
  if(s.fill&&s.rect&&a>=PA*0.04){boxes.push(s.r);continue;}
  const rule=s.rect&&Math.min(w,h)<=thin;                    // 罫線・飾り線・枠の一辺
  parts.push({r:s.r,rule,shape:!s.rect});
 }
 // 近い部品を束ねる
 const gap=Math.max(4,Math.min(pw,ph)*0.015),groups=[];
 for(const p of parts){
  const hit=groups.filter(g=>rHit(g.r,p.r,gap));
  const g={r:p.r,items:[p]};
  for(const h of hit){g.r=rUnion(g.r,h.r);g.items.push(...h.items);groups.splice(groups.indexOf(h),1);}
  groups.push(g);
 }
 // 束同士が後から重なった場合もまとめる
 for(let merged=true;merged;){merged=false;
  for(let a=0;a<groups.length&&!merged;a++)for(let b=a+1;b<groups.length&&!merged;b++)
   if(rHit(groups[a].r,groups[b].r,gap)){groups[a]={r:rUnion(groups[a].r,groups[b].r),items:groups[a].items.concat(groups[b].items)};groups.splice(b,1);merged=true;}
 }
 // 同じ箱に接する束はつなぐ（フローチャート：箱→矢印→箱→矢印…）。小さい箱だけを仲介にする
 const smallBoxes=boxes.filter(b=>rArea(b)<PA*0.08);
 for(let merged=true;merged;){merged=false;
  for(let a=0;a<groups.length&&!merged;a++)for(let b=a+1;b<groups.length&&!merged;b++)
   if(smallBoxes.some(x=>rHit(x,groups[a].r,2)&&rHit(x,groups[b].r,2))){
    groups[a]={r:rUnion(groups[a].r,groups[b].r),items:groups[a].items.concat(groups[b].items)};groups.splice(b,1);merged=true;}
 }
 const growByBoxes=r=>{                                    // 囲む枠・接する箱を取り込む（図形どうしの連鎖のみ。文字では連鎖させない）
  for(let changed=true,guard=0;changed&&guard<20;guard++){changed=false;
   for(const b of boxes){
    if(rArea(b)>=PA*0.3||rArea(b)>rArea(r)*4&&!(b[0]<=r[0]&&b[2]>=r[2]&&b[1]<=r[1]&&b[3]>=r[3]))continue;
    if(rHit(b,r,2)){const u=rUnion(r,b);if(rArea(u)>rArea(r)+0.5){r=u;changed=true;}}
   }
  }
  return r;
 };
 for(const f of figs)f.r=growByBoxes(f.r);
 for(const g of groups){
  if(g.items.length<3)continue;
  const shapesN=g.items.filter(x=>x.shape||!x.rule).length;
  // 罫線だけの束：外周以外にも線がある（表・グラフの目盛り等）なら図。枠の4辺だけなら図ではない
  const inner=g.items.filter(x=>x.rule&&x.r[0]>g.r[0]+thin*2&&x.r[2]<g.r[2]-thin*2||x.rule&&x.r[1]>g.r[1]+thin*2&&x.r[3]<g.r[3]-thin*2).length;
  if(shapesN===0&&inner<2)continue;
  const r=growByBoxes(g.r),w=r[2]-r[0],h=r[3]-r[1];
  if(w<pw*0.15||h<ph*0.03||w*h<PA*0.015)continue;          // 小さいアイコン・細い帯は図にしない
  figs.push({r,raster:false});
 }
 if(debug)Object.assign(debug,{shapes,boxes,groups:groups.map(g=>({r:g.r,n:g.items.length,items:g.items}))});
 // ベクター図に重なる文字（ラベル）を図に含め、本文から外す。1回だけ判定し、段落を連鎖的に飲み込まない
 const used=new Set();
 for(const f of figs){
  if(f.raster)continue;                                     // 写真の上下の本文・キャプションは本文に残す
  const base=f.r;let r=base;
  tRects.forEach((t,k)=>{
   if(used.has(k))return;
   if(rHit(t,base,Math.max(2,lines[k].size*0.8))){used.add(k);r=rUnion(r,t);}
  });
  f.r=r;
 }
 // 重なる図はまとめる
 let out=figs.map(f=>f.r);
 for(let merged=true;merged;){merged=false;
  for(let a=0;a<out.length&&!merged;a++)for(let b=a+1;b<out.length&&!merged;b++){
   if(rHit(out[a],out[b],0)){out[a]=rUnion(out[a],out[b]);out.splice(b,1);merged=true;}
  }
 }
 // 余白を少し付ける
 const pad=Math.min(pw,ph)*0.01;
 out=out.map(r=>[Math.max(vb[0],r[0]-pad),Math.max(vb[1],r[1]-pad),Math.min(vb[2],r[2]+pad),Math.min(vb[3],r[3]+pad)]);
 return{rects:out,labels:used};
}
// 図の範囲を 528×792 の1ページに描く（横長の図は opt.rotateWide のとき90°回して大きく表示）
async function renderFigurePage(page,rect,opt){
 const W=528,H=792,M=12,rw=rect[2]-rect[0],rh=rect[3]-rect[1];
 const rotate=!!opt.rotateWide&&rw/rh>1.3;
 const bw=rotate?H-2*M:W-2*M,bh=rotate?W-2*M:H-2*M,s=Math.min(bw/rw,bh/rh);
 const vp=page.getViewport({scale:s}),vr=vp.convertToViewportRectangle(rect);
 const vx=Math.min(vr[0],vr[2]),vy=Math.min(vr[1],vr[3]);
 const c=document.createElement('canvas');c.width=Math.max(1,Math.round(rw*s));c.height=Math.max(1,Math.round(rh*s));
 const cx=c.getContext('2d');cx.fillStyle='#fff';cx.fillRect(0,0,c.width,c.height);
 await page.render({canvasContext:cx,viewport:vp,background:'rgb(255,255,255)',transform:[1,0,0,1,-vx,-vy]}).promise;
 const out=document.createElement('canvas');out.width=W;out.height=H;
 const ox=out.getContext('2d',{willReadFrequently:true});ox.fillStyle='#fff';ox.fillRect(0,0,W,H);
 if(rotate){ox.save();ox.translate(W/2,H/2);ox.rotate(-Math.PI/2);ox.drawImage(c,-c.width/2,-c.height/2);ox.restore();}
 else ox.drawImage(c,Math.round((W-c.width)/2),Math.round((H-c.height)/2));
 const data=ox.getImageData(0,0,W,H).data;
 c.width=c.height=0;out.width=out.height=0;
 return g.EbookForgeManga.encodeFigure(data,W,H);
}
async function pdfToBook(files,progress=()=>{},opt={}){
 const lib=await loadPDF(),assets=await pdfAssets(),pages=[],figures=[];
 let title='';
 for(const file of files){
  if(fileType(file.name)!=='pdf')err('「文字を組み直す」はPDFだけに使えます: '+file.name);
  if(file.size>MAX_PDF_SIZE)err('PDFは35MB以内にしてください');
  title=title||displayName(file.name).replace(/\.pdf$/i,'');
  const doc=await lib.getDocument({data:new Uint8Array(await file.arrayBuffer()),stopAtErrors:true,isEvalSupported:false,
   cMapUrl:assets.cMapUrl,cMapPacked:true,standardFontDataUrl:assets.standardFontDataUrl}).promise;
  try{
   if(doc.numPages>MAX_PDF_PAGES*3)err(`PDFは${MAX_PDF_PAGES*3}ページ以内にしてください`);
   for(let i=1;i<=doc.numPages;i++){
    const page=await doc.getPage(i);
    try{
     const lines=pdfPageLines(await page.getTextContent());
     if(opt.figures!==false&&figures.length<300){
      const{rects,labels}=await pageFigureRects(lib,page,lines);
      // 図のラベル（図の中に描かれる文字）は本文から外す
      if(labels.size){const keep=lines.filter((l,k)=>!labels.has(k));lines.length=0;lines.push(...keep);}
      // 図の上端より下にある最初の行の前に図を挿す（横書き）。縦書きのページはページ末尾
      for(const r of rects.sort((a,b)=>b[3]-a[3])){
       const id=figures.length;figures.push(await renderFigurePage(page,r,opt));
       const k=lines.some(l=>l.vertical)?-1:lines.findIndex(l=>!l.fig&&l.pos<r[3]-1);
       const mark={fig:id,pos:r[3],size:0,chars:0,str:''};
       if(k<0)lines.push(mark);else lines.splice(k,0,mark);
      }
     }
     pages.push(lines);
    }finally{if(page.cleanup)page.cleanup();}
    progress(i,doc.numPages);
    if(i%5===0)await new Promise(ok=>setTimeout(ok,0));
   }
  }catch(e){if(e?.name==='PasswordException')throw Error('パスワード付きPDFは未対応です');throw e;}
  finally{await doc.destroy();}
 }
 const book=linesToBook(pages,title);book.figures=figures;return book;
}
g.EbookForgeDocuments={
 fileType,acceptedImage,fromPDF,fromRAR,pdfToBook,pdfPageLines,linesToBook,displayName,pageFigureRects,ENGINE:'0.6.1',
 // Test hooks do not activate in the normal app.
 ...(typeof g.__EBOOKFORGE_TEST__==='boolean'&&g.__EBOOKFORGE_TEST__?
   {_setTestDependencies:deps=>Object.assign(testDeps,deps)}:{})
};
})(typeof window!=='undefined'?window:globalThis);
