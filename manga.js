/* EbookForge Web manga conversion (client-side, no protected-site scraping).
 * Image/CBZ/ZIP -> fixed-layout X3 XTC (1-bit) / XTCH (2-bit).
 */
(function(g){
'use strict';
const W=528,H=792,MAX_FILES=180,MAX_PAGES=400,MAX_IMAGE_BYTES=35*1048576;
const IMAGE_EXT=/\.(?:jpe?g|png|webp)$/i;
const collator=new Intl.Collator('ja',{numeric:true,sensitivity:'base'});
const natural=(a,b)=>collator.compare(a.name||a,b.name||b);
const sleep=()=>new Promise(resolve=>setTimeout(resolve,0));
function boundsFor(width,height,trim,image){
 if(!trim)return{x:0,y:0,w:width,h:height};
 const canvas=document.createElement('canvas');
 const scale=Math.min(1,320/Math.max(width,height));
 canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
 const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
 ctx.drawImage(image,0,0,canvas.width,canvas.height);
 const pix=ctx.getImageData(0,0,canvas.width,canvas.height).data;
 let left=canvas.width,top=canvas.height,right=-1,bottom=-1,ink=0;
 for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
   const p=(y*canvas.width+x)*4;
   if(pix[p]*.299+pix[p+1]*.587+pix[p+2]*.114>=240)continue;
   left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);ink++;
 }
 if(ink<24)return{x:0,y:0,w:width,h:height};
 const pad=3;
 left=Math.max(0,left-pad);right=Math.min(canvas.width-1,right+pad);
 top=Math.max(0,top-pad);bottom=Math.min(canvas.height-1,bottom+pad);
 const x=Math.floor(left/scale),y=Math.floor(top/scale);
 return{x,y,w:Math.min(width-x,Math.ceil((right-left+1)/scale)),
   h:Math.min(height-y,Math.ceil((bottom-top+1)/scale))};
}
function planRegions(width,height,opt,measureTrim){
 const parts=[];
 const doSplit=opt.spread==='always'||opt.spread==='auto'&&width>height*1.18;
 if(doSplit && width>=2){
  const half=Math.floor(width/2);
  const left={x:0,y:0,w:half,h:height},right={x:half,y:0,w:width-half,h:height};
  parts.push(...(opt.reading==='rtl'?[right,left]:[left,right]));
 }else parts.push({x:0,y:0,w:width,h:height});
 const out=[];
 for(const p of parts){
  // Crop boxes are expressed in source-image coordinates.
  let r=p;
  if(opt.trim && measureTrim){
   const b=measureTrim(p);
   if(b && b.w>0&&b.h>0)r=b;
  }
  const maxSegment=Math.max(1,Math.floor(r.w*H/W));
  const count=opt.long==='auto'&&r.h/r.w>2.15?Math.ceil(r.h/maxSegment):1;
  if(count>60)throw Error('長い画像が60分割を超えます');
  for(let i=0;i<count;i++){
   const y=r.y+Math.floor(r.h*i/count),end=r.y+Math.floor(r.h*(i+1)/count);
   out.push({x:r.x,y,w:r.w,h:end-y});
  }
 }
 return out;
}
function inkInRegion(image,r){
 const c=document.createElement('canvas'),scale=Math.min(1,340/Math.max(r.w,r.h));
 c.width=Math.max(1,Math.round(r.w*scale));c.height=Math.max(1,Math.round(r.h*scale));
 const ctx=c.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
 ctx.drawImage(image,r.x,r.y,r.w,r.h,0,0,c.width,c.height);
 const pix=ctx.getImageData(0,0,c.width,c.height).data;
 let l=c.width,t=c.height,rr=-1,bb=-1,ink=0;
 for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
  const i=(y*c.width+x)*4;
  if(pix[i]*.299+pix[i+1]*.587+pix[i+2]*.114>239)continue;
  l=Math.min(l,x);t=Math.min(t,y);rr=Math.max(rr,x);bb=Math.max(bb,y);ink++;
 }
 if(ink<24)return r;
 l=Math.max(0,l-3);t=Math.max(0,t-3);rr=Math.min(c.width,rr+4);bb=Math.min(c.height,bb+4);
 const x=r.x+Math.floor(l/scale),y=r.y+Math.floor(t/scale);
 return{x,y,w:Math.min(r.x+r.w-x,Math.ceil((rr-l)/scale)),
  h:Math.min(r.y+r.h-y,Math.ceil((bb-t)/scale))};
}
function encodeGray(pixels,width,height,format='xtc',contrast=1,dither=false){
 if(!['xtc','xtch'].includes(format))throw Error('形式を選択してください');
 if(pixels.length!==width*height*4)throw Error('画像データのサイズが違います');
 const xtch=format==='xtch';
 const stride=Math.ceil(width/8),colStride=Math.ceil(height/8),planeSize=width*colStride;
 const out=new Uint8Array(xtch?2*planeSize:stride*height);
 if(!xtch)out.fill(255);
 const bayer=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const pos=(y*width+x)*4;
  // Canvas compositing is done on opaque white.
  let gray=pixels[pos]*.299+pixels[pos+1]*.587+pixels[pos+2]*.114;
  gray=Math.max(0,Math.min(255,(gray-128)*contrast+128));
  if(dither)gray=Math.max(0,Math.min(255,gray+(bayer[(y&3)*4+(x&3)]-7.5)*(xtch?5:9)));
  if(xtch){
   // CrossPoint XTH: 0=white, 1=dark gray, 2=light gray, 3=black.
   const idx=gray>=208?0:gray>=128?2:gray>=48?1:3;
   const off=(width-1-x)*colStride+(y>>3),bit=128>>(y&7);
   if(idx&2)out[off]|=bit;
   if(idx&1)out[planeSize+off]|=bit;
  }else if(gray<128)out[y*stride+(x>>3)]&=~(128>>(x&7));
 }
 return out;
}
function sanitizeName(n){return String(n||'漫画').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,70);}
function isImageName(n){return IMAGE_EXT.test(n)&&!n.startsWith('__MACOSX/')&&!/(^|\/)\./.test(n);}
function chapterKey(src){
 const n=src.entryName||src.name,segments=n.split('/'),folder=segments.slice(0,-1);
 if(src.archive){return folder.length?`${src.archive} / ${folder.join(' / ')}`:src.archive;}
 return '画像集';
}
async function collect(files,progress=()=>{}){
 if(!files.length)throw Error('画像・ZIP・CBZファイルを選んでください');
 if(files.length>MAX_FILES)throw Error(`入力は${MAX_FILES}ファイルまでです`);
 let total=0,src=[];
 const disposers=[];
 try{
 for(let i=0;i<files.length;i++){
  const file=files[i],low=file.name.toLowerCase();total+=file.size;
  if(total>90*1048576)throw Error('入力ファイルの合計は90MBまでです');
  const documentType=g.EbookForgeDocuments?.fileType(low);
  if(documentType){
   const adapter=documentType==='pdf'?
     await g.EbookForgeDocuments.fromPDF(file):
     await g.EbookForgeDocuments.fromRAR(file);
   disposers.push(adapter.close);
   src.push(...adapter.sources);
   if(src.length>MAX_FILES)throw Error(`画像の枚数は${MAX_FILES}枚以内にしてください`);
  }else if(/\.(?:cbz|zip)$/i.test(low)){
   if(file.size>70*1048576)throw Error('ZIP/CBZは70MBまでです');
   const zip=g.EbookForgeEpub.readZIP(new Uint8Array(await file.arrayBuffer()),false);
   const imgs=zip.filter(e=>isImageName(e.name));
   if(!imgs.length)throw Error('ZIP/CBZ内に対応画像がありません: '+file.name);
   for(const e of imgs){
    if(e.size>MAX_IMAGE_BYTES)throw Error('ZIP内に35MBを超える画像があります');
    const name=e.name,archive=file.name.replace(/\.(zip|cbz)$/i,'');
    src.push({name:archive+'/'+name,entryName:name,archive,
     open:async()=>new Blob([await g.EbookForgeEpub.unpack(e)],{type:guessType(name)})});
   }
  }else if(IMAGE_EXT.test(low)){
   if(file.size>MAX_IMAGE_BYTES)throw Error('35MBを超える画像があります');
   src.push({name:file.name,open:async()=>file});
  }else if(/\.(heic|heif)$/i.test(low)){
   throw Error('HEIC写真は現在未対応です。iPhoneの共有画面でJPEGに変換してから読み込んでください。');
  }else throw Error('画像・PDF・ZIP・CBZ・RAR・CBRに対応しています: '+file.name);
  progress(i+1,files.length);await sleep();
 }
 if(src.length>MAX_FILES)throw Error(`画像の枚数は${MAX_FILES}枚以内にしてください`);
 // Each archive uses a stable logical group, then naturally sort page names.
 src.sort((a,b)=>natural(a,b));
 let disposed=false;
 src.dispose=async()=>{
  if(disposed)return;
  disposed=true;
  await Promise.allSettled(disposers.map(fn=>fn()));
 };
 return src;
 }catch(e){
  await Promise.allSettled(disposers.map(fn=>fn()));
  throw e;
 }
}
function guessType(n){
 return /\.png$/i.test(n)?'image/png':/\.webp$/i.test(n)?'image/webp':'image/jpeg';
}
async function decodeBlob(blob){
 const url=URL.createObjectURL(blob);
 try{
  const im=new Image();im.src=url;
  if(typeof im.decode==='function')await im.decode();
  else await new Promise((ok,no)=>{im.onload=ok;im.onerror=no;});
  if(!im.naturalWidth||!im.naturalHeight)throw Error('画像を開けません');
  if(im.naturalWidth*im.naturalHeight>30e6)throw Error('3000万画素を超える画像があります');
  return {image:im,release:()=>URL.revokeObjectURL(url)};
 }catch(e){URL.revokeObjectURL(url);throw e;}
}
async function render(sources,opt,progress=()=>{},cancel=()=>false){
 if(!sources.length)throw Error('画像がありません');
 const format=opt.format||'xtc';
 const pages=[],chapters=[];
 const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});
 let lastKey=null;
 for(let i=0;i<sources.length;i++){
  if(cancel())throw Error('変換を中止しました');
  const src=sources[i],blob=await src.open();
  const {image,release}=await decodeBlob(blob);
  try{
   const key=chapterKey(src);
   const regions=planRegions(image.naturalWidth,image.naturalHeight,opt,
     r=>inkInRegion(image,r));
   if(lastKey!==key){chapters.push({title:key,page:pages.length});lastKey=key;}
   for(const r of regions){
    if(cancel())throw Error('変換を中止しました');
    if(pages.length>=MAX_PAGES)throw Error(`出力ページが${MAX_PAGES}枚を超えています`);
    ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);
    const scale=Math.min(W/r.w,H/r.h),w=r.w*scale,h=r.h*scale;
    ctx.drawImage(image,r.x,r.y,r.w,r.h,(W-w)/2,(H-h)/2,w,h);
    const data=ctx.getImageData(0,0,W,H).data;
    pages.push(encodeGray(data,W,H,format,Number(opt.contrast)||1,Boolean(opt.dither)));
   }
  }finally{release();}
  progress(i+1,sources.length,pages.length);
  await sleep();
 }
 return{width:W,height:H,pages,chapters,format};
}
g.EbookForgeManga={natural,planRegions,encodeGray,collect,render,chapterKey,decodeBlob,sanitizeName};
})(typeof window!=='undefined'?window:globalThis);
