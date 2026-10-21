/* EbookForge Web v0.3 smartphone UX. Official Narou metadata API only; book bytes are local. */
(function(){
'use strict';
const $=id=>document.getElementById(id);let book=null,imageFiles=[],sourceEpub=null,result=null,index=0,stack=[],readingPage=0,key='';
function msg(id,s){$(id).textContent=String(s);}
function history(){
 let items=[];try{items=JSON.parse(localStorage.getItem('ebookforge-history')||'[]');}catch(_){}
 const box=$('conversion-history');box.replaceChildren();
 if(!Array.isArray(items)||!items.length){box.textContent='履歴なし';return;}
 for(const item of items.slice(0,10)){const div=document.createElement('p');
 div.textContent=`${item.date}　${item.title}　${item.pages}ページ　${item.profile}`;box.appendChild(div);}
}
function remember(n){try{
 const items=JSON.parse(localStorage.getItem('ebookforge-history')||'[]');
 items.unshift({date:new Date().toLocaleDateString('ja-JP'),title:book.title,pages:n,profile:$('profile').value});
 localStorage.setItem('ebookforge-history',JSON.stringify(items.slice(0,10)));
}catch(_){}history();}
function mode(){
 const cp=$('profile').value==='crosspoint';
 $('profile-info').textContent=cp?'CrossPoint向け：EPUBは端末で直接読む選択肢もあります。XTCには章情報を埋め込みます。':'純正X3向け：XTCでページを固定します。端末の章ジャンプ・操作は実機で検証してください。';
 $('transfer-guide').textContent=cp?'X3でFile Transfer → Wi-Fi接続 → QRコード/アドレスで転送画面を開く → 保存したXTCまたはEPUBをアップロードします。':'純正ファームでは保存したXTCを対応する方法でX3に取り込んでください。';
 $('book-save-epub').hidden=!cp||!sourceEpub;
 try{localStorage.setItem('ebookforge-profile',$('profile').value);}catch(_){}
}
try{if(localStorage.getItem('ebookforge-profile')==='crosspoint')$('profile').value='crosspoint';}catch(_){}
$('profile').addEventListener('change',mode);mode();history();
function tocRefresh(){
 if(!book)return;
 msg('toc-summary',`${book.chapters.filter(c=>c.selected!==false).length} / ${book.chapters.length}章を選択`);
}
function useBook(b,imgs=[]){
 book=b;imageFiles=imgs;result=null;
 $('book-title').value=b.title||'電子書籍';$('book-author').value=b.author||'';
 $('preview-box').hidden=true;$('book-toc-box').hidden=false;
 const el=$('book-toc');el.replaceChildren();
 b.chapters.forEach((ch,i)=>{
  const label=document.createElement('label'),input=document.createElement('input'),span=document.createElement('span');
  input.type='checkbox';input.checked=true;
  input.addEventListener('change',()=>{ch.selected=input.checked;tocRefresh();});
  span.textContent=`${i+1}. ${ch.title}（${ch.text.length}文字）`;
  label.append(input,span);el.appendChild(label);
 });
 tocRefresh();mode();
}
for(const [id,checked] of [['toc-all',true],['toc-none',false]]){
 $(id).addEventListener('click',()=>{if(!book)return;book.chapters.forEach(c=>c.selected=checked);
 $('book-toc').querySelectorAll('input').forEach(x=>x.checked=checked);tocRefresh();});
}
$('book-from-text').addEventListener('click',()=>{
 try{sourceEpub=null;useBook(EbookForgeBook.fromText($('book-input').value,$('book-title').value,/^\s*#{1,3}\s+/m.test($('book-input').value)));
 msg('book-load-status',`${book.chapters.length}章を抽出しました`);}
 catch(e){msg('book-load-status','エラー: '+e.message);}
});
function readEncoding(buffer){
 try{return new TextDecoder('utf-8',{fatal:true}).decode(buffer);}
 catch(_){return new TextDecoder('shift_jis',{fatal:true}).decode(buffer);}
}
$('book-load').addEventListener('click',async()=>{
 const files=Array.from($('book-file').files||[]),btn=$('book-load');btn.disabled=true;
 try{
  if(!files.length)throw Error('ファイルを選択してください');
  if(files.some(f=>f.size>70*1048576))throw Error('ファイルが70MBを超えています');
  const ext=files[0].name.split('.').pop().toLowerCase();let b,img=[];
  if(['jpg','jpeg','png','webp'].includes(ext)){
   if(files.length>80||files.some(f=>!/\.(png|jpe?g|webp)$/i.test(f.name)))throw Error('画像だけを80枚以内で選択してください');
   img=files;sourceEpub=null;b={title:files.length===1?files[0].name:'画像集',author:'',source:'image',
    chapters:files.map(f=>({title:f.name,text:'[画像]',selected:true}))};
  }else if(ext==='epub'){
   if(files.length!==1)throw Error('EPUBは1冊ずつ選択してください');sourceEpub=files[0];
   msg('book-load-status','EPUBの章を解析中…');
   b=await EbookForgeBook.fromEpub(new Uint8Array(await files[0].arrayBuffer()),(i,n)=>msg('book-load-status',`EPUB解析 ${i}/${n}`));
  }else if(['txt','md','markdown'].includes(ext)){
   if(files.length!==1)throw Error('TXT/MDは1冊ずつ選択してください');sourceEpub=null;
   b=EbookForgeBook.fromText(readEncoding(await files[0].arrayBuffer()),files[0].name.replace(/\.[^.]+$/,''),ext!=='txt');
  }else throw Error('対応形式はTXT・MD・EPUB・画像です');
  useBook(b,img);msg('book-load-status',`${b.chapters.length}章を読み込みました。`);
 }catch(e){msg('book-load-status','エラー: '+e.message);}
 finally{btn.disabled=false;}
});
function showPage(n,remember=false,saveReading=true){
 if(!result)return;if(remember)stack.push(index);
 index=Math.max(0,Math.min(n,result.pages.length-1));
 EbookForgeBook.decodePage(result.pages[index],528,792,$('preview'));
 msg('preview-count',`${index+1} / ${result.pages.length}ページ`);
 $('preview-back').disabled=!stack.length;
 $('preview-prev').disabled=index===0;$('preview-next').disabled=index===result.pages.length-1;
 if(saveReading){readingPage=index;try{localStorage.setItem(key,String(index));}catch(_){}}
}
$('preview-prev').addEventListener('click',()=>showPage(index-1));
$('preview-next').addEventListener('click',()=>showPage(index+1));
$('preview-back').addEventListener('click',()=>{if(stack.length)showPage(stack.pop(),false,false);});
$('preview-resume').addEventListener('click',()=>showPage(readingPage,false,false));
$('preview-chapters').addEventListener('change',e=>showPage(Number(e.target.value),true,false));
async function picturePages(files,progress){
 const W=528,H=792,row=W/8,pages=[],chapters=[];
 const c=document.createElement('canvas');c.width=W;c.height=H;const ctx=c.getContext('2d',{willReadFrequently:true});
 for(let i=0;i<files.length;i++){
  const url=URL.createObjectURL(files[i]);
  try{
   const im=new Image();im.src=url;await im.decode();
   if(im.naturalHeight*im.naturalWidth>25e6)throw Error('画像の画素数が大きすぎます');
   ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);
   const scale=Math.min(W/im.naturalWidth,H/im.naturalHeight),w=scale*im.naturalWidth,h=scale*im.naturalHeight;
   ctx.drawImage(im,(W-w)/2,(H-h)/2,w,h);
   // Preserve transparent image pixels on white rather than black.
   const pixel=ctx.getImageData(0,0,W,H).data,out=new Uint8Array(row*H);out.fill(255);
   for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const p=(y*W+x)*4,a=pixel[p+3]/255;
    const lum=(pixel[p]*.299+pixel[p+1]*.587+pixel[p+2]*.114)*a+255*(1-a);
    if(lum<128)out[y*row+(x>>3)]&=~(128>>(x&7));
   }
   chapters.push({title:files[i].name,page:pages.length});pages.push(out);
  }finally{URL.revokeObjectURL(url);}
  progress(i+1,files.length);
 }
 return {pages,chapters,width:W,height:H};
}
$('book-build').addEventListener('click',async()=>{
 const btn=$('book-build');btn.disabled=true;
 try{
  if(!book)throw Error('先に本を読み込んでください');
  if(!book.chapters.some(c=>c.selected!==false))throw Error('章を選択してください');
  if(book.source==='image'){
   const selected=imageFiles.filter((f,i)=>book.chapters[i].selected!==false);
   result=await picturePages(selected,(i,n)=>msg('book-status',`画像 ${i}/${n}`));
  }else{
   msg('book-status','ページを生成中…');
   result=await EbookForgeBook.renderBook(book,{
    vertical:$('direction').value==='vertical',font:Number($('book-size').value),
    margin:Number($('book-margin').value),spacing:Number($('book-spacing').value)},
    (i,n)=>msg('book-status',`章 ${i}/${n}`));
  }
  book.title=$('book-title').value||book.title;book.author=$('book-author').value||'';
  key='ebookforge-page:'+book.title+':'+book.author;stack=[];
  const list=$('preview-chapters');list.replaceChildren();
  for(const ch of result.chapters){
   const opt=document.createElement('option');opt.value=String(ch.page);
   opt.textContent=`${ch.title}（${ch.page+1}ページ）`;list.appendChild(opt);
  }
  $('preview-box').hidden=false;
  let saved=0;try{saved=Number(localStorage.getItem(key)||0);}catch(_){}
  showPage(Math.min(saved,result.pages.length-1));
  msg('book-status',`完了：${result.pages.length}ページ／${result.chapters.length}章。目次ジャンプを試せます。`);
 }catch(e){result=null;$('preview-box').hidden=true;msg('book-status','変換エラー: '+e.message);}
 finally{btn.disabled=false;}
});
function download(b,name,mime){
 const blob=new Blob([b],{type:mime}),url=URL.createObjectURL(blob);
 const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),30000);
}
$('book-export').addEventListener('click',()=>{
 try{if(!result||!book)throw Error('先に変換してください');
 const bytes=EbookForgeBook.buildXtcWithChapters(result.pages,result.chapters,book.title,book.author,$('direction').value==='vertical');
 download(bytes,EbookForgeBook.safeName(book.title)+'.xtc','application/octet-stream');
 remember(result.pages.length);
 msg('book-status',`${result.pages.length}ページ、${result.chapters.length}章のXTCを保存しました。${(bytes.length/1048576).toFixed(1)}MB`);
 }catch(e){msg('book-status','保存エラー: '+e.message);}
});
$('book-save-epub').addEventListener('click',()=>{
 if(sourceEpub&&$('profile').value==='crosspoint')download(sourceEpub,EbookForgeBook.safeName(book?.title||'ebook')+'.epub','application/epub+zip');
});
function searchNarou(query){
 return new Promise((resolve,reject)=>{
  const cb='__ebookforge_'+Date.now()+'_'+Math.floor(Math.random()*1e6),scr=document.createElement('script');
  let done=false;
  const cleanup=()=>{done=true;clearTimeout(timer);delete window[cb];scr.remove();};
  const timer=setTimeout(()=>{if(!done){cleanup();reject(Error('APIの応答がありません'));}},12000);
  window[cb]=data=>{cleanup();resolve(data);};
  const qs=new URLSearchParams({out:'jsonp',callback:cb,word:query,of:'n-t-w-ga',lim:'15'});
  scr.src='https://api.syosetu.com/novelapi/api/?'+qs.toString();
  scr.onerror=()=>{cleanup();reject(Error('なろうAPIの取得に失敗しました'));};
  document.head.appendChild(scr);
 });
}
$('narou-search-btn').addEventListener('click',async()=>{
 const q=$('narou-search').value.trim(),btn=$('narou-search-btn'),box=$('narou-results');
 if(!q||q.length>80){box.textContent='1〜80文字の検索語を入力してください';return;}
 btn.disabled=true;box.textContent='公式APIを検索中…';
 try{
  const data=await searchNarou(q);
  const found=Array.isArray(data)?data.filter(x=>x&&/^[nN][0-9a-zA-Z]{4,12}$/.test(x.ncode||'')):[];
  box.replaceChildren();if(!found.length){box.textContent='該当作品はありません';return;}
  for(const w of found){
   const d=document.createElement('div');d.className='search-result';
   const a=document.createElement('a');a.href='https://ncode.syosetu.com/'+w.ncode.toLowerCase()+'/';
   a.textContent=w.title||w.ncode;a.rel='noopener';a.target='_blank';
   const p=document.createElement('p');p.textContent='作者: '+(w.writer||'不明');
   d.append(a,p);box.appendChild(d);
  }
 }catch(e){box.textContent=e.message;}
 finally{btn.disabled=false;}
});

let aozoraWorks=null;
$('aozora-load').addEventListener('click',async()=>{
 const f=$('aozora-file').files[0],button=$('aozora-load');
 if(!f){msg('aozora-results','作品一覧のZIPかCSVを指定してください');return;}
 if(f.size>40*1048576){msg('aozora-results','40MB以下の作品一覧を選んでください');return;}
 button.disabled=true;
 try{msg('aozora-results','作品一覧を解析しています…');
  aozoraWorks=await EbookForgeAozora.load(new Uint8Array(await f.arrayBuffer()));
  msg('aozora-results',`${aozoraWorks.length.toLocaleString('ja-JP')}件の作品情報を読み込みました。検索してください。`);
 }catch(e){aozoraWorks=null;msg('aozora-results','読込エラー: '+e.message);}
 finally{button.disabled=false;}
});
$('aozora-search-btn').addEventListener('click',()=>{
 const box=$('aozora-results');if(!aozoraWorks){box.textContent='先に作品一覧のZIP/CSVを読み込んでください';return;}
 const list=EbookForgeAozora.search(aozoraWorks,$('aozora-search').value);
 box.replaceChildren();
 if(!list.length){box.textContent='該当作品はありません';return;}
 for(const w of list){
  const d=document.createElement('div');d.className='search-result';
  const a=document.createElement('a');a.href=w.url;a.target='_blank';a.rel='noopener';a.textContent=w.title;
  const sub=document.createElement('p');sub.textContent=w.author;
  d.append(a,sub);box.appendChild(d);
 }
});
})();
