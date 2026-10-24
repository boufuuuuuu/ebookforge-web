/* Manga page controls for EbookForge Web. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
let result=null,page=0,reading=0,stack=[],cancel=false,libraryKey='';
function status(s){$('manga-status').textContent=s;}
function show(n,push=false,record=true){
 if(!result)return;
 if(push)stack.push(page);
 page=Math.min(result.pages.length-1,Math.max(0,Number(n)||0));
 EbookForgeBook.decodePage(result.pages[page],528,792,$('manga-preview'),result.format==='xtch');
 $('manga-page-count').textContent=`${page+1} / ${result.pages.length}ページ・${result.format.toUpperCase()}`;
 $('manga-prev').disabled=page===0;$('manga-next').disabled=page===result.pages.length-1;
 $('manga-back').disabled=!stack.length;
 if(record){reading=page;try{localStorage.setItem(libraryKey,String(page));}catch(_){}}
}
function memNote(){
 const fmt=$('manga-format').value,b=EbookForgeManga.pageBufferBytes(fmt);
 const kb=(b/1024).toFixed(1);
 $('manga-mem-note').textContent=fmt==='xtch'?
  `⚠ XTCH（4階調）は端末が1ページ表示ごとに約${kb}KBの連続メモリを確保します（X3の528×792では白黒の2倍）。端末に「メモリエラー」が出る場合はXTC（白黒）＋「順序ディザ」に切り替えてください。`:
  `XTC（白黒）：端末が1ページ表示ごとに確保するメモリは約${kb}KB。灰色の多い漫画・写真は「順序ディザ」をオンにすると階調が残ります。`;
}
$('manga-format').addEventListener('change',memNote);memNote();
$('manga-prev').addEventListener('click',()=>show(page-1));
$('manga-next').addEventListener('click',()=>show(page+1));
$('manga-back').addEventListener('click',()=>{if(stack.length)show(stack.pop(),false,false);});
$('manga-resume').addEventListener('click',()=>show(reading,false,false));
$('manga-chapters').addEventListener('change',e=>show(Number(e.target.value),true,false));
$('manga-cancel').addEventListener('click',()=>{cancel=true;status('中止処理中…');});
function fillChapters(){
 const chapterSelect=$('manga-chapters');chapterSelect.replaceChildren();
 for(const ch of result.chapters){
  const option=document.createElement('option');
  option.value=String(ch.page);option.textContent=`${ch.title}（${ch.page+1}ページ）`;
  chapterSelect.appendChild(option);
 }
}
$('manga-build').addEventListener('click',async()=>{
 const btn=$('manga-build'),raw=Array.from($('manga-files').files||[]);
 btn.disabled=true;cancel=false;$('manga-cancel').hidden=false;
 let sources=null;
 $('manga-preview-box').hidden=true;result=null;stack=[];$('manga-volumes').replaceChildren();
 try{
  status('画像一覧を確認しています…');
  // Yield to the browser before CPU-heavy processing.
  await new Promise(ok=>setTimeout(ok,10));
  if($('manga-pdf-mode').value==='reflow'){
   // v0.5.7: PDF の文字を取り出して、選んだ文字サイズで組み直す（小さい文字のPDF向け）
   if(!raw.length)throw Error('PDFを選んでください');
   status('PDFから文字を取り出しています…');
   const figMode=$('manga-reflow-fig').value;
   const book=await EbookForgeDocuments.pdfToBook(raw,(i,n)=>status(`文字と図を取り出し中：${i}/${n}ページ`),
     {figures:figMode!=='off',rotateWide:figMode==='rotate'});
   if(cancel)throw Error('処理を中止しました');
   status(`組版中：${book.chapters.length}章（${book.vertical?'縦書き':'横書き'}）…`);
   // 電子ペーパーの白黒表示では明朝の細い横線が消えやすいため、ゴシック体・やや太字・しきい値高めで組む
   const r=await EbookForgeBook.renderBook(book,{vertical:book.vertical,font:Number($('manga-reflow-size').value)||22,
     fontFamily:'"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Noto Sans CJK JP",sans-serif',fontWeight:600,inkThreshold:150,
     figures:book.figures},
     (i,n)=>status(`組版中：${i}/${n}章`));
   result={pages:r.pages,chapters:r.chapters,format:'xtc',width:528,height:792};
   if(!$('manga-title').value||$('manga-title').value==='漫画・写真集')$('manga-title').value=book.title;
   fillChapters();
   libraryKey='ebookforge-manga-page:'+($('manga-title').value||'漫画');
   $('manga-preview-box').hidden=false;show(0);
   status(`変換完了（文字を組み直し・v0.6.0）：${book.chapters.length}章・図${book.figures.length}枚 → ${result.pages.length}ページ。図は1ページずつ挿入します。XTC（白黒）で保存します。`);
   return;
  }
  sources=await EbookForgeManga.collect(raw,(i,n)=>status(`ファイルを確認中：${i}/${n}`));
  if(cancel)throw Error('処理を中止しました');
  const opt={format:$('manga-format').value,reading:$('manga-reading').value,
    spread:$('manga-spread').value,long:$('manga-long').value,
    pdfSplit:$('manga-pdf-split').value,sharpText:$('manga-sharp').value,
    trim:$('manga-trim').value==='on',
    contrast:Number($('manga-contrast').value),dither:$('manga-dither').value==='on'};
  result=await EbookForgeManga.render(sources,opt,(i,n,p)=>status(`変換中：画像${i}/${n}・${p}ページ`),()=>cancel);
  if(cancel)throw Error('処理を中止しました');
  fillChapters();
  libraryKey='ebookforge-manga-page:'+($('manga-title').value||'漫画');
  let saved=0;try{saved=Number(localStorage.getItem(libraryKey)||0);}catch(_){}
  $('manga-preview-box').hidden=false;
  show(Math.min(result.pages.length-1,Math.max(0,saved)));
  const sh=result.stats?.sharp2x?`・文字くっきり${result.stats.sharp2x}ページ`:'';
  status(`変換完了（v${result.engine||'?'}${sh}）：${sources.length}画像 → ${result.pages.length}ページ、${result.chapters.length}章。XTC/XTCHファイルを保存できます。`);
 }catch(e){
  result=null;$('manga-preview-box').hidden=true;
  status('変換できませんでした：'+e.message);
 }finally{
  if(sources?.dispose)await sources.dispose();
  btn.disabled=false;$('manga-cancel').hidden=true;
 }
});
function saveVolume(vol,k,n,name,rtl,fmt){
 const title=n>1?`${name} (${k}/${n})`:name;
 const bytes=EbookForgeBook.buildXtcWithChapters(vol.pages,vol.chapters,title,'',rtl,fmt);
 const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));
 const a=document.createElement('a');a.href=url;
 a.download=EbookForgeManga.sanitizeName(name)+(n>1?'_'+String(k).padStart(2,'0'):'')+'.'+fmt;
 document.body.appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),30000);
 return bytes.length;
}
$('manga-export').addEventListener('click',()=>{
 try{
  if(!result)throw Error('先に漫画を変換してください');
  const name=($('manga-title').value||'漫画・写真集').trim();
  const rtl=$('manga-reading').value==='rtl';
  const fmt=result.format;
  const vols=EbookForgeManga.splitVolumes(result.pages,result.chapters,Number($('manga-volume').value));
  const box=$('manga-volumes');box.replaceChildren();
  const mem=`端末の1ページ表示に必要なメモリ：約${(EbookForgeManga.pageBufferBytes(fmt)/1024).toFixed(1)}KB`;
  if(vols.length===1){
   const size=saveVolume(vols[0],1,1,name,rtl,fmt);
   status(`保存しました：${size.toLocaleString('ja-JP')}バイト・${result.pages.length}ページ。${mem}。X3実機での表示確認は別途必要です。`);
   return;
  }
  // iPhone Safari は連続ダウンロードを止めることがあるため、巻ごとに保存ボタンを出す
  vols.forEach((v,i)=>{
   const b=document.createElement('button');
   b.textContent=`第${i+1}巻を保存（${v.from+1}〜${v.to}ページ）`;
   b.addEventListener('click',()=>{
    try{const size=saveVolume(v,i+1,vols.length,name,rtl,fmt);b.textContent+=` ✓ ${size.toLocaleString('ja-JP')}バイト`;}
    catch(e){status('保存できませんでした：'+e.message);}
   });
   box.appendChild(b);
  });
  status(`${vols.length}冊に分けました。下のボタンで1冊ずつ保存してください。${mem}。`);
 }catch(e){status('保存できませんでした：'+e.message);}
});
try{const v=document.createElement('p');v.className='hint';v.id='engine-version';
 v.textContent='読み込まれている処理プログラム：manga '+(EbookForgeManga.ENGINE||'?')+' / pdf '+(EbookForgeDocuments.ENGINE||'?')+' / 画面 0.6.0';
 document.querySelector('h1')?.after(v);}catch(_){}
})();
