/* EbookForge Web manga conversion v0.5.8 (client-side, no protected-site scraping).
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
  // v0.5.2: 縦長判定は「トリミング前」の形で行う。トリミング後で判定すると、文字の少ないページ
  // （章扉・数行だけの縦書きページ）が細長い領域になり、行の途中で上下に切断されていた。
  const isLong=opt.long==='auto'&&p.h/p.w>2.15;
  const maxSegment=Math.max(1,Math.floor(r.w*H/W));
  const count=isLong?Math.max(1,Math.ceil(r.h/maxSegment)):1;
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
// v0.5.5: 分割位置を「行間・段間の空白」に吸着させる。profile[i]=i番目の行(列)のインク量。
// target 付近 ±window の範囲で、インク0の連続区間のうち target に最も近い区間の中央を返す。
// 空白が無ければインク最小の位置（文字を切る量が最も少ない位置）。
function snapCut(profile,target,window){
 const n=profile.length,lo=Math.max(1,Math.floor(target-window)),hi=Math.min(n-2,Math.ceil(target+window));
 let best=null,i=lo;
 while(i<=hi){
  if(profile[i]===0){let j=i;while(j+1<=hi&&profile[j+1]===0)j++;
   const c=(i+j)/2,d=Math.abs(c-target);if(!best||d<best.d)best={c,d};i=j+1;}
  else i++;
 }
 if(best)return Math.round(best.c);
 let m=lo;for(let k=lo;k<=hi;k++)if(profile[k]<profile[m])m=k;
 return m;
}
// 分割計画。box=本文範囲、prof={x:列ごとのインク量, y:行ごとのインク量}（box 座標系・縮小率 s）。
// mode: 'h2r' 横書き1段＝上下2分割＋90°回転 / 'col2ltr' 横書き2段組＝左段上→左段下→右段上→右段下
//       'col2rtl' 縦書き2段組（上段・下段）＝上段右→上段左→下段右→下段左
function planPdfSplit(box,mode,profAt){
 const cut=(axis,a0,a1)=>{ // a0..a1（box 内座標）の中央付近で空白に吸着
  const p=profAt(axis,a0,a1);const s=p.scale;
  const t=(p.values.length-1)/2;return a0+Math.round(snapCut(p.values,t,p.values.length*0.18)/s);
 };
 const R=(x0,y0,x1,y1,rotate=false)=>({x:box.x+x0,y:box.y+y0,w:x1-x0,h:y1-y0,rotate,group:true});
 const W0=box.w,H0=box.h;
 if(mode==='h2r'){
  const y=cut('y',0,H0);
  return[R(0,0,W0,y,true),R(0,y,W0,H0,true)];
 }
 if(mode==='col2ltr'){
  const x=cut('x',0,W0);                         // 段間（縦の余白）
  const yl=cut('y',0,H0),yr=yl;                  // 各段を行間で上下に
  return[R(0,0,x,yl),R(0,yl,x,H0),R(x,0,W0,yr),R(x,yr,W0,H0)];
 }
 if(mode==='col2rtl'){
  const y=cut('y',0,H0);                         // 上段と下段の境（横の余白）
  const xt=cut('x',0,W0);                        // 各段を列間で左右に
  return[R(xt,0,W0,y),R(0,0,xt,y),R(xt,y,W0,H0),R(0,y,xt,H0)];
 }
 return[R(0,0,W0,H0)];
}
// 画像の領域 r のインク投影（axis='x' は列ごと、'y' は行ごと）。a0..a1 は r 内の範囲。
function inkProfile(image,r,axis,a0,a1){
 const c=document.createElement('canvas'),s=Math.min(1,600/Math.max(r.w,r.h));
 c.width=Math.max(1,Math.round(r.w*s));c.height=Math.max(1,Math.round(r.h*s));
 const ctx=c.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);
 ctx.drawImage(image,r.x,r.y,r.w,r.h,0,0,c.width,c.height);
 const pix=ctx.getImageData(0,0,c.width,c.height).data;
 const b0=Math.floor(a0*s),b1=Math.min(axis==='x'?c.width:c.height,Math.ceil(a1*s));
 const values=new Array(Math.max(1,b1-b0)).fill(0);
 for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
  const i=(y*c.width+x)*4;
  if(pix[i]*.299+pix[i+1]*.587+pix[i+2]*.114>239)continue;
  const k=(axis==='x'?x:y)-b0;if(k>=0&&k<values.length)values[k]++;
 }
 return{values,scale:s};
}
// v0.5.6: 文字向けの適応二値化（Bradley 法）。各画素を周囲 win×win の平均明るさと比べ、
// 平均より t 以上暗ければ「文字」とする。灰色の細い文字も黒く残り、薄い灰色の背景は白になる。
// 返り値: Uint8Array(width*height)  1=文字（黒）
function textMask(pixels,width,height,win=Math.round(width/14),t=0.16){
 const gray=new Float32Array(width*height);
 for(let i=0;i<width*height;i++)gray[i]=pixels[i*4]*.299+pixels[i*4+1]*.587+pixels[i*4+2]*.114;
 const W1=width+1,sum=new Float64Array(W1*(height+1));
 for(let y=0;y<height;y++){let row=0;for(let x=0;x<width;x++){row+=gray[y*width+x];sum[(y+1)*W1+x+1]=sum[y*W1+x+1]+row;}}
 const half=Math.max(4,win>>1),mask=new Uint8Array(width*height);
 for(let y=0;y<height;y++){
  const y0=Math.max(0,y-half),y1=Math.min(height,y+half+1);
  for(let x=0;x<width;x++){
   const g=gray[y*width+x];
   if(g>235)continue;                                  // 紙の白はそのまま白
   const x0=Math.max(0,x-half),x1=Math.min(width,x+half+1);
   const area=(x1-x0)*(y1-y0);
   const mean=(sum[y1*W1+x1]-sum[y0*W1+x1]-sum[y1*W1+x0]+sum[y0*W1+x0])/area;
   if(g<=mean*(1-t)||g<64)mask[y*width+x]=1;            // 周囲より暗い／十分に黒い
  }
 }
 return mask;
}
function encodeGray(pixels,width,height,format='xtc',contrast=1,dither=false,sharpText=false){
 if(!['xtc','xtch'].includes(format))throw Error('形式を選択してください');
 if(pixels.length!==width*height*4)throw Error('画像データのサイズが違います');
 const xtch=format==='xtch';
 const stride=Math.ceil(width/8),colStride=Math.ceil(height/8),planeSize=width*colStride;
 const out=new Uint8Array(xtch?2*planeSize:stride*height);
 if(!xtch)out.fill(255);
 const bayer=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
 // 文字くっきりは「文字のページ」だけに適用：紙の白（明るさ>235）が描画範囲の半分以上あるページ。
 // 写真・漫画のページは濃淡が輪郭だけになるのを避けるため、従来の変換のまま。
 let mask=null;
 if(sharpText){
  let paper=0;for(let i=0;i<width*height;i++){const g=pixels[i*4]*.299+pixels[i*4+1]*.587+pixels[i*4+2]*.114;if(g>235)paper++;}
  if(paper>=width*height*0.5)mask=textMask(pixels,width,height);
 }
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const pos=(y*width+x)*4;
  if(mask){
   // 文字くっきり：文字は黒、それ以外は XTC=白 / XTCH=明るい灰色まで残す（図の濃淡用）
   const ink=mask[y*width+x]===1;
   if(xtch){
    const g0=pixels[pos]*.299+pixels[pos+1]*.587+pixels[pos+2]*.114;
    const idx=ink?3:g0>=200?0:g0>=120?2:1;
    const off=(width-1-x)*colStride+(y>>3),bit=128>>(y&7);
    if(idx&2)out[off]|=bit;
    if(idx&1)out[planeSize+off]|=bit;
   }else if(ink)out[y*stride+(x>>3)]&=~(128>>(x&7));
   continue;
  }
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
// v0.5.7: 2倍解像度で描いたページ（2W×2H）から文字を判定し、2×2 画素ごとに出力画素へまとめる。
// 小さい文字は1倍で描くと線が薄く途切れるが、2倍なら線が濃く連続して描けるため判定が安定する。
// 写真・漫画のページ（紙の白が半分未満）は平均で縮小して従来の変換に回す。
function down2(p2,w,h){
 const out=new Uint8ClampedArray(w*h*4),W2=w*2;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const a=((y*2)*W2+x*2)*4,b=a+4,c=a+W2*4,d=c+4,o=(y*w+x)*4;
  for(let k=0;k<3;k++)out[o+k]=(p2[a+k]+p2[b+k]+p2[c+k]+p2[d+k]+2)>>2;
  out[o+3]=255;
 }
 return out;
}
function encodeGray2x(p2,width,height,format='xtc',contrast=1,dither=false,pool=1){
 const W2=width*2,H2=height*2;
 let paper=0;for(let i=0;i<W2*H2;i++){const g=p2[i*4]*.299+p2[i*4+1]*.587+p2[i*4+2]*.114;if(g>235)paper++;}
 const small=down2(p2,width,height);
 if(paper<W2*H2*0.5)return encodeGray(small,width,height,format,contrast,dither,false);   // 写真・漫画ページ
 const m2=textMask(p2,W2,H2,Math.round(W2/14));
 const xtch=format==='xtch';
 const stride=Math.ceil(width/8),colStride=Math.ceil(height/8),planeSize=width*colStride;
 const out=new Uint8Array(xtch?2*planeSize:stride*height);if(!xtch)out.fill(255);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*2)*W2+x*2,n=m2[i]+m2[i+1]+m2[i+W2]+m2[i+W2+1];
  const ink=n>=pool;
  if(xtch){
   const o=(y*width+x)*4,g0=small[o]*.299+small[o+1]*.587+small[o+2]*.114;
   const idx=ink?3:g0>=200?0:g0>=120?2:1;
   const off=(width-1-x)*colStride+(y>>3),bit=128>>(y&7);
   if(idx&2)out[off]|=bit;
   if(idx&1)out[planeSize+off]|=bit;
  }else if(ink)out[y*stride+(x>>3)]&=~(128>>(x&7));
 }
 out.sharp=true;
 return out;
}
// 端末が1ページ表示ごとに確保する連続メモリ（CrossPoint XtcReaderActivity::renderPage の malloc と同じ式）
function pageBufferBytes(format,width=W,height=H){
 return format==='xtch'?width*Math.ceil(height/8)*2:Math.ceil(width/8)*height;
}
function sanitizeName(n){return String(n||'漫画').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,70);}
function isImageName(n){return IMAGE_EXT.test(n)&&!n.startsWith('__MACOSX/')&&!/(^|\/)\./.test(n);}
function chapterKey(src){
 const dn=g.EbookForgeDocuments?.displayName||(x=>x);
 const n=dn(src.entryName||src.name),segments=n.split('/'),folder=segments.slice(0,-1);
 if(src.archive){const a=dn(src.archive);return folder.length?`${a} / ${folder.join(' / ')}`:a;}
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
// PDF など「ページ」として作られた文書は、全ページ共通の余白（サンプルページの本文範囲の和集合）で切る。
// 端まで絵があるページは計算から除外。返り値は正規化座標 {x0,y0,x1,y1}（0..1）。
async function uniformBox(group,progress,cancel){
 const n=group.length,idx=[...new Set([0,n-1,...Array.from({length:7},(_,k)=>Math.floor(n*(k+1)/8))])]
   .filter(i=>i>=0&&i<n).sort((a,b)=>a-b);
 let box=null;
 for(const i of idx){
  if(cancel())throw Error('変換を中止しました');
  const {image,release}=await decodeBlob(await group[i].open());
  try{
   const w=image.naturalWidth,h=image.naturalHeight,full={x:0,y:0,w,h};
   const b=inkInRegion(image,full);
   if(b===full)continue;                                   // 白紙（インクなし）
   if(b.w>=w*.97&&b.h>=h*.97)continue;                     // 端まで絵（フルブリード）
   const nb={x0:b.x/w,y0:b.y/h,x1:(b.x+b.w)/w,y1:(b.y+b.h)/h};
   box=box?{x0:Math.min(box.x0,nb.x0),y0:Math.min(box.y0,nb.y0),x1:Math.max(box.x1,nb.x1),y1:Math.max(box.y1,nb.y1)}:nb;
  }finally{release();}
  progress&&progress();
  await sleep();
 }
 return box;
}
async function render(sources,opt,progress=()=>{},cancel=()=>false){
 if(!sources.length)throw Error('画像がありません');
 const format=opt.format||'xtc';
 const pages=[],chapters=[];
 const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});
 let canvas2=null,ctx2=null;const stats={sharp2x:0};
 const boxes=new Map();
 if(opt.trim){
  const groups=new Map();
  for(const s of sources)if(s.uniformGroup){if(!groups.has(s.uniformGroup))groups.set(s.uniformGroup,[]);groups.get(s.uniformGroup).push(s);}
  for(const [k,grp] of groups)boxes.set(k,await uniformBox(grp,null,cancel));
 }
 let lastKey=null;
 for(let i=0;i<sources.length;i++){
  if(cancel())throw Error('変換を中止しました');
  const src=sources[i],blob=await src.open();
  const {image,release}=await decodeBlob(blob);
  try{
   const key=chapterKey(src);
   const ub=src.uniformGroup?boxes.get(src.uniformGroup):undefined;
   const iw=image.naturalWidth,ih=image.naturalHeight;
   const measure=src.uniformGroup?
     (r=>{ // 文書共通の余白をこの領域に適用（見開き分割時は各半面と交差）
       if(!ub)return r;
       const x0=Math.max(r.x,Math.floor(ub.x0*iw)),y0=Math.max(r.y,Math.floor(ub.y0*ih));
       const x1=Math.min(r.x+r.w,Math.ceil(ub.x1*iw)),y1=Math.min(r.y+r.h,Math.ceil(ub.y1*ih));
       return x1-x0>8&&y1-y0>8?{x:x0,y:y0,w:x1-x0,h:y1-y0}:r;
     }):(r=>inkInRegion(image,r));
   const popt=src.kind==='pdf'?{...opt,long:'none'}:opt;   // PDF のページは縦長分割しない
   let regions;
   const pdfSplit=src.kind==='pdf'?String(opt.pdfSplit||'none'):'none';
   if(['h2r','col2ltr','col2rtl'].includes(pdfSplit)){
    // 本文範囲（文書共通の余白を除いた領域）を、行間・段間の空白で分ける
    const full={x:0,y:0,w:iw,h:ih},box=opt.trim?measure(full):full;
    regions=planPdfSplit(box,pdfSplit,(axis,a0,a1)=>inkProfile(image,box,axis,a0,a1));
   }else regions=planRegions(iw,ih,popt,measure);
   if(lastKey!==key){chapters.push({title:key,page:pages.length});lastKey=key;}
   // 分割したページ同士は同じ倍率にする（ページごとに文字の大きさが変わらないように）
   const gscale=regions.some(r=>r.group)?Math.min(...regions.map(r=>r.rotate?Math.min(W/r.h,H/r.w):Math.min(W/r.w,H/r.h))):null;
   const sharp=src.kind==='pdf'&&opt.sharpText!=='off';
   const F=sharp&&src.renderRegion&&opt.pdfDirect!==false?2:1;   // 2倍描画
   const cv=F===1?canvas:(canvas2||(canvas2=Object.assign(document.createElement('canvas'),{width:W*2,height:H*2})));
   const cx=F===1?ctx:(ctx2||(ctx2=cv.getContext('2d',{willReadFrequently:true})));
   for(const r of regions){
    if(cancel())throw Error('変換を中止しました');
    if(pages.length>=MAX_PAGES)throw Error(`出力ページが${MAX_PAGES}枚を超えています`);
    cx.fillStyle='#fff';cx.fillRect(0,0,W*F,H*F);
    // PDF は最終倍率で直接描いた画像を 1:1 で配置（縮小による文字の欠けを防ぐ）
    let srcImg=image,sr=r,direct=null;
    if(src.renderRegion&&opt.pdfDirect!==false){
     const k=(gscale||(r.rotate?Math.min(W/r.h,H/r.w):Math.min(W/r.w,H/r.h)))*F;
     direct=await src.renderRegion(r,k);
     srcImg=direct;sr={x:0,y:0,w:direct.width,h:direct.height,rotate:r.rotate,group:r.group};
    }
    const TW=W*F,TH=H*F;
    try{
    if(r.rotate){
     // 端末を時計回りに90°倒して読む。内容の上端を端末の左端に揃える
     const scale=direct?1:(gscale||Math.min(W/r.h,H/r.w)),w=sr.w*scale,h=sr.h*scale;
     const ox=r.group?h/2:TW/2;
     cx.save();cx.translate(Math.round(ox),Math.round(TH/2));cx.rotate(-Math.PI/2);
     cx.drawImage(srcImg,sr.x,sr.y,sr.w,sr.h,Math.round(-w/2),Math.round(-h/2),w,h);cx.restore();
    }else{
     const scale=direct?1:(gscale||Math.min(W/r.w,H/r.h)),w=sr.w*scale,h=sr.h*scale;
     const oy=r.group?0:(TH-h)/2;                   // 分割ページは上端に揃える
     cx.drawImage(srcImg,sr.x,sr.y,sr.w,sr.h,Math.round((TW-w)/2),Math.round(oy),w,h);
    }
    }finally{if(direct){direct.width=0;direct.height=0;}}
    const data=cx.getImageData(0,0,TW,TH).data;
    if(F===2){const pg=encodeGray2x(data,W,H,format,Number(opt.contrast)||1,Boolean(opt.dither),Number(opt.sharpPool)||1);
     if(pg.sharp)stats.sharp2x++;pages.push(pg);}
    else pages.push(encodeGray(data,W,H,format,Number(opt.contrast)||1,Boolean(opt.dither),sharp));
   }
  }finally{release();}
  progress(i+1,sources.length,pages.length);
  await sleep();
 }
 if(canvas2){canvas2.width=0;canvas2.height=0;}
 return{width:W,height:H,pages,chapters,format,stats,engine:'0.5.8'};
}
// 分冊: pages を size ページずつに分け、各巻の章リストを付け直す（巻頭には直前の章を引き継ぐ）
function splitVolumes(pages,chapters,size){
 const n=pages.length;size=Math.floor(Number(size)||0);
 if(!size||n<=size)return[{pages,chapters,from:0,to:n}];
 const vols=[];
 for(let from=0;from<n;from+=size){
  const to=Math.min(n,from+size);
  const inside=chapters.filter(c=>c.page>=from&&c.page<to).map(c=>({title:c.title,page:c.page-from}));
  const prev=[...chapters].reverse().find(c=>c.page<from);
  if(prev&&!inside.some(c=>c.page===0))inside.unshift({title:prev.title,page:0});
  vols.push({pages:pages.slice(from,to),chapters:inside,from,to});
 }
 return vols;
}
g.EbookForgeManga={natural,planRegions,encodeGray,collect,render,chapterKey,decodeBlob,sanitizeName,
 pageBufferBytes,splitVolumes,snapCut,planPdfSplit,textMask,encodeGray2x,PAGE_W:W,PAGE_H:H,ENGINE:'0.5.8'};
})(typeof window!=='undefined'?window:globalThis);
