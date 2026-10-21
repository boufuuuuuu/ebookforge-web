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
$('manga-prev').addEventListener('click',()=>show(page-1));
$('manga-next').addEventListener('click',()=>show(page+1));
$('manga-back').addEventListener('click',()=>{if(stack.length)show(stack.pop(),false,false);});
$('manga-resume').addEventListener('click',()=>show(reading,false,false));
$('manga-chapters').addEventListener('change',e=>show(Number(e.target.value),true,false));
$('manga-cancel').addEventListener('click',()=>{cancel=true;status('中止処理中…');});
$('manga-build').addEventListener('click',async()=>{
 const btn=$('manga-build'),raw=Array.from($('manga-files').files||[]);
 btn.disabled=true;cancel=false;$('manga-cancel').hidden=false;
 let sources=null;
 $('manga-preview-box').hidden=true;result=null;stack=[];
 try{
  status('画像一覧を確認しています…');
  // Yield to the browser before CPU-heavy processing.
  await new Promise(ok=>setTimeout(ok,10));
  sources=await EbookForgeManga.collect(raw,(i,n)=>status(`ファイルを確認中：${i}/${n}`));
  if(cancel)throw Error('処理を中止しました');
  const opt={format:$('manga-format').value,reading:$('manga-reading').value,
    spread:$('manga-spread').value,long:$('manga-long').value,
    trim:$('manga-trim').value==='on',
    contrast:Number($('manga-contrast').value),dither:$('manga-dither').value==='on'};
  result=await EbookForgeManga.render(sources,opt,(i,n,p)=>status(`変換中：画像${i}/${n}・${p}ページ`),()=>cancel);
  if(cancel)throw Error('処理を中止しました');
  const chapterSelect=$('manga-chapters');chapterSelect.replaceChildren();
  for(const ch of result.chapters){
   const option=document.createElement('option');
   option.value=String(ch.page);option.textContent=`${ch.title}（${ch.page+1}ページ）`;
   chapterSelect.appendChild(option);
  }
  libraryKey='ebookforge-manga-page:'+($('manga-title').value||'漫画');
  let saved=0;try{saved=Number(localStorage.getItem(libraryKey)||0);}catch(_){}
  $('manga-preview-box').hidden=false;
  show(Math.min(result.pages.length-1,Math.max(0,saved)));
  status(`変換完了：${sources.length}画像 → ${result.pages.length}ページ、${result.chapters.length}章。XTC/XTCHファイルを保存できます。`);
 }catch(e){
  result=null;$('manga-preview-box').hidden=true;
  status('変換できませんでした：'+e.message);
 }finally{
  if(sources?.dispose)await sources.dispose();
  btn.disabled=false;$('manga-cancel').hidden=true;
 }
});
$('manga-export').addEventListener('click',()=>{
 try{
  if(!result)throw Error('先に漫画を変換してください');
  const name=($('manga-title').value||'漫画・写真集').trim();
  const rtl=$('manga-reading').value==='rtl';
  const fmt=result.format;
  const bytes=EbookForgeBook.buildXtcWithChapters(result.pages,result.chapters,name,'',rtl,fmt);
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));
  const a=document.createElement('a');a.href=url;
  a.download=EbookForgeManga.sanitizeName(name)+'.'+fmt;
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
  status(`保存しました：${bytes.length.toLocaleString('ja-JP')}バイト・${result.pages.length}ページ。X3実機での表示確認は別途必要です。`);
 }catch(e){status('保存できませんでした：'+e.message);}
});
})();
