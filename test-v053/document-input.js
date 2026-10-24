/* EbookForge Web 0.5.8: PDF and RAR/CBR adapters.
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
function pdfPageLines(tc){
 const styles=tc.styles||{},lines=[];let cur=null;
 const flush=()=>{if(cur&&cur.str.trim())lines.push(cur);cur=null;};
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
 const all=pages.flat();
 if(!all.length)err('このPDFには文字情報がありません（スキャン画像のPDFは組み直せません）。「画像として変換」を使ってください');
 // 本文の文字サイズ＝文字数で重み付けした中央値
 const sizes=[];for(const l of all)for(let k=0;k<Math.min(l.chars,200);k++)sizes.push(l.size);
 sizes.sort((a,b)=>a-b);const body=sizes[Math.floor(sizes.length/2)]||10;
 const vertical=all.filter(l=>l.vertical).reduce((n,l)=>n+l.chars,0)*2>all.reduce((n,l)=>n+l.chars,0);
 const chapters=[];let ch={title:'本文',text:'',pageMark:0};
 const END=/[。．.！？!?」』）)：:]$/;
 // 大見出しのしきい値：見出し候補（本文の1.35倍以上）の中で大きい側。候補が1種類ならそれを大見出しとする
 const heads=[...new Set(all.filter(l=>l.size>=body*1.35).map(l=>Math.round(l.size*2)/2))].sort((a,b)=>b-a);
 const h1=heads.length>1?Math.max(body*1.8,heads[0]*0.85):(heads[0]||Infinity);
 let pageNo=0;
 for(const lines of pages){
  pageNo++;
  if(ch.pageMark!==pageNo&&ch.text&&!/\n$/.test(ch.text))ch.text+='\n';
  // 段落の復元：同じ大きさ・同じ書き出し位置で続く行をひとまとまり（ブロック）とし、
  // ブロックの右端（縦書きは下端）近くまで届いている行は「折り返し」とみなして次の行とつなぐ
  const blocks=[];
  for(const l of lines){
   const b=blocks[blocks.length-1],p=b&&b[b.length-1];
   if(p&&!(l.size>=body*1.35)&&!(p.size>=body*1.35)&&Math.abs(l.size-p.size)<p.size*0.15&&
      Math.abs(l.a0-p.a0)<=p.size*1.2&&Math.abs(l.pos-p.pos)<=p.size*2.4)b.push(l);
   else blocks.push([l]);
  }
  for(const b of blocks){
   const edge=Math.max(...b.map(l=>l.a1));
   let para='';
   b.forEach((l,k)=>{
    const s=l.str.replace(/\s+/g,' ').trim();if(!s)return;
    if(l.size>=body*1.35&&s.length<=60){
     // 見出し直前の短いラベル行（「はじめに」「01・説明」等）は見出しの下へ移す
     const rows=ch.text.replace(/\n+$/,'').split('\n'),last=rows[rows.length-1]||'';
     const label=last&&last.length<=16&&!/^[■●]/.test(last)&&ch.pageMark===pageNo?last:'';
     if(label)ch.text=rows.slice(0,-1).join('\n')+'\n';
     if(l.size>=h1){                                    // 大見出し → 章（改ページ・目次）
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
 return{title,author:'',chapters,source:'pdf',vertical};
}
async function pdfToBook(files,progress=()=>{}){
 const lib=await loadPDF(),assets=await pdfAssets(),pages=[];
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
    try{pages.push(pdfPageLines(await page.getTextContent()));}finally{if(page.cleanup)page.cleanup();}
    progress(i,doc.numPages);
    if(i%5===0)await new Promise(ok=>setTimeout(ok,0));
   }
  }catch(e){if(e?.name==='PasswordException')throw Error('パスワード付きPDFは未対応です');throw e;}
  finally{await doc.destroy();}
 }
 return linesToBook(pages,title);
}
g.EbookForgeDocuments={
 fileType,acceptedImage,fromPDF,fromRAR,pdfToBook,pdfPageLines,linesToBook,displayName,ENGINE:'0.5.8',
 // Test hooks do not activate in the normal app.
 ...(typeof g.__EBOOKFORGE_TEST__==='boolean'&&g.__EBOOKFORGE_TEST__?
   {_setTestDependencies:deps=>Object.assign(testDeps,deps)}:{})
};
})(typeof window!=='undefined'?window:globalThis);
