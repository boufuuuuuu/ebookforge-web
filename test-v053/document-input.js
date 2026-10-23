/* EbookForge Web 0.5.3: PDF and RAR/CBR adapters.
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
   name:`${file.name.replace(/\.pdf$/i,'')}/${String(i+1).padStart(5,'0')}.png`,
   archive:file.name.replace(/\.pdf$/i,''),
   kind:'pdf',uniformGroup:'pdf:'+file.name+':'+file.size,
   entryName:`${String(i+1).padStart(5,'0')}.png`,
   open:async()=>{
    if(closed)err('PDFは既に閉じられました');
    const page=await doc.getPage(i+1);
    let canvas;
    try{
     const base=page.getViewport({scale:1});
     const scale=Math.min(2,1600/Math.max(base.width,base.height),
       Math.sqrt(3.2e6/(base.width*base.height)));
     if(!Number.isFinite(scale)||scale<=0)err('PDFのページサイズが不正です');
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
 const archive=file.name.replace(/\.(rar|cbr)$/i,'');
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
g.EbookForgeDocuments={
 fileType,acceptedImage,fromPDF,fromRAR,
 // Test hooks do not activate in the normal app.
 ...(typeof g.__EBOOKFORGE_TEST__==='boolean'&&g.__EBOOKFORGE_TEST__?
   {_setTestDependencies:deps=>Object.assign(testDeps,deps)}:{})
};
})(typeof window!=='undefined'?window:globalThis);
