/* EbookForge Web 0.7.0: カクヨムの作品URLから本文を取り込む（あなた専用の中継サーバー経由）
 * - 取得はあなたの中継サーバー（worker/kakuyomu-relay.js）を通す。合言葉はヘッダで送る
 * - 1話ずつ1.5秒以上の間隔をあける。中止できる。取得した本文は端末内だけで使う
 * - 目次は __NEXT_DATA__（ページに埋め込まれたデータ）から読み、読めなければページ内の目次のリンクから読む
 * - 本文のルビ・傍点はカクヨム記法（｜漢字《かんじ》・《《傍点》》）に直して、既存の組版に渡す
 * - 失敗したときは、どの段階で何が見つからなかったかを返す（ページの作りが変わったときに直せるように）
 */
(function(g){
'use strict';
const WORK_RE=/^https?:\/\/kakuyomu\.jp\/works\/(\d{1,30})(?:\/episodes\/\d{1,30})?\/?(?:[?#].*)?$/;
function parseWorkUrl(u){const m=String(u||'').trim().match(WORK_RE);if(!m)throw Error('カクヨムの作品URL（https://kakuyomu.jp/works/数字）を入れてください');return m[1];}
function doc(html){return new DOMParser().parseFromString(String(html),'text/html');}
const clean=s=>String(s||'').replace(/[ \t\r\n\f\v]+/g,' ').replace(/^[ ]+|[ ]+$/g,'');   // 全角スペースは表記どおり残す

// --- 目次（作品ページ）
function nextData(d){
 const el=d.getElementById('__NEXT_DATA__');if(!el)return null;
 try{return JSON.parse(el.textContent);}catch(_){return null;}
}
function findState(obj,key,depth=0){          // Apollo の正規化データ（"Work:ID" を持つ表）を探す
 if(!obj||typeof obj!=='object'||depth>8)return null;
 if(Object.prototype.hasOwnProperty.call(obj,key))return obj;
 for(const k of Object.keys(obj)){const r=findState(obj[k],key,depth+1);if(r)return r;}
 return null;
}
const deref=(st,x)=>x&&typeof x==='object'&&x.__ref?st[x.__ref]:x;
function tocFromNextData(d,workId){
 const nd=nextData(d);if(!nd)return{why:'埋め込みデータ（__NEXT_DATA__）なし'};
 const st=findState(nd,'Work:'+workId);if(!st)return{why:'埋め込みデータに作品（Work:'+workId+'）なし'};
 const w=st['Work:'+workId],title=clean(w.title),au=deref(st,w.author);
 const author=clean(au&&(au.activityName||au.name||au.screenName));
 const list=Array.isArray(w.tableOfContents)?w.tableOfContents:Array.isArray(w.tableOfContentsV2)?w.tableOfContentsV2:null;
 if(!list)return{why:'埋め込みデータに目次（tableOfContents）なし',title,author};
 const episodes=[];
 for(const item of list){
  const ch=deref(st,item);if(!ch)continue;
  const chap=deref(st,ch.chapter),chapTitle=clean(chap&&chap.title);
  const eps=ch.episodeUnions||ch.episodes||[];
  let first=true;
  for(const e of eps){const ep=deref(st,e);if(!ep||!ep.id)continue;
   episodes.push({id:String(ep.id),title:clean(ep.title)||'無題',chapter:first?chapTitle:''});first=false;}
 }
 if(!episodes.length)return{why:'埋め込みデータの目次が空',title,author};
 return{title,author,episodes,via:'埋め込みデータ'};
}
function tocFromLinks(d,workId){
 const re=new RegExp('^(?:https?://kakuyomu\\.jp)?/works/'+workId+'/episodes/(\\d{1,30})/?$');
 const anchors=[...d.querySelectorAll('a[href]')].filter(a=>re.test(a.getAttribute('href')));
 const ids=new Set(anchors.map(a=>a.getAttribute('href').match(re)[1]));
 if(!ids.size)return{why:'ページ内に話へのリンクなし'};
 // 目次の入れ物＝話へのリンクの8割以上を含む、いちばん内側の要素（冒頭の「1話目から読む」等のリンクに順番を乱されない）
 let box=null,best=Infinity;
 for(const a of anchors)for(let p=a.parentElement;p;p=p.parentElement){
  const inside=new Set([...p.querySelectorAll('a[href]')].filter(x=>re.test(x.getAttribute('href'))).map(x=>x.getAttribute('href').match(re)[1]));
  if(inside.size>=Math.ceil(ids.size*0.8)){const size=p.querySelectorAll('*').length;if(size<best){best=size;box=p;}break;}
 }
 const seen=new Set(),episodes=[];
 for(const a of [...(box||d).querySelectorAll('a[href]')]){
  const m=(a.getAttribute('href')||'').match(re);if(!m||seen.has(m[1]))continue;seen.add(m[1]);
  const t=a.querySelector('[class*="itle"]');episodes.push({id:m[1],title:clean((t||a).textContent)||'無題',chapter:''});
 }
 return{episodes,via:'ページ内の目次'};
}
function parseWork(html,workId){
 const d=doc(html),a=tocFromNextData(d,workId);
 let r=a.episodes?a:tocFromLinks(d,workId);
 if(!r.episodes)throw Error(`目次を読み取れませんでした（${a.why}／${r.why}）。カクヨムのページの作りが変わった可能性があります`);
 const og=d.querySelector('meta[property="og:title"]');
 const title=a.title||clean(d.querySelector('h1')&&d.querySelector('h1').textContent)||clean(og&&og.content).replace(/\s*[-｜|]\s*カクヨム.*$/,'')||'カクヨム作品';
 const author=a.author||'';
 return{title,author,episodes:r.episodes,via:r.via};
}

// --- 本文（話のページ）
function toNotation(node){
 let out='';
 for(const n of node.childNodes){
  if(n.nodeType===3){out+=n.nodeValue.replace(/《/g,'|《');continue;}
  if(n.nodeType!==1)continue;
  const tag=n.localName,cls=String(n.getAttribute('class')||'');
  if(tag==='rt'||tag==='rp'||tag==='script'||tag==='style')continue;
  if(tag==='br'){out+='\n';continue;}
  if(tag==='ruby'){
   const rt=[...n.querySelectorAll('rt')].map(x=>x.textContent).join('').trim();
   const rb=n.querySelector('rb');let base=rb?rb.textContent:'';
   if(!rb)for(const c of n.childNodes){if(c.nodeType===3)base+=c.nodeValue;else if(c.nodeType===1&&!/^(rt|rp)$/.test(c.localName))base+=c.textContent;}
   base=base.trim();out+=rt&&base?'｜'+base+'《'+rt+'》':base;continue;
  }
  if(tag==='em'&&/emphasis/i.test(cls)||/emphasisDots/i.test(cls)){const t=n.textContent;out+=t?'《《'+t+'》》':'';continue;}
  out+=toNotation(n);
 }
 return out;
}
function parseEpisode(html){
 const d=doc(html);
 let body=d.querySelector('[class*="episodeBody"]');
 if(!body){                                        // 予備：<p id="p1"> 形式の段落をいちばん多く持つ要素
  let best=0;for(const el of d.querySelectorAll('div,section,article,main')){
   const n=[...el.children].filter(c=>c.localName==='p'&&/^p\d+$/.test(c.id||'')).length;if(n>best){best=n;body=el;}}
 }
 if(!body)throw Error('本文の場所（episodeBody）を見つけられませんでした');
 const paras=[...body.querySelectorAll(':scope > p')];
 const text=(paras.length?paras.map(p=>/\bblank\b/.test(p.getAttribute('class')||'')?'':toNotation(p)):[toNotation(body)])
  .join('\n').replace(/ /g,' ').replace(/\n{4,}/g,'\n\n\n').trim();
 if(!text)throw Error('本文が空でした');
 const t=d.querySelector('[class*="episodeTitle"]');
 return{title:clean(t&&t.textContent),text};
}

// --- 取り込み
async function viaRelay(relay,key,url,signal){
 let base;try{base=new URL(String(relay).trim());}catch(_){throw Error('中継サーバーのURLが不正です');}
 if(base.protocol!=='https:')throw Error('中継サーバーのURLは https:// で始めてください');
 base.search='';base.searchParams.set('url',url);
 const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),30000);
 const stop=()=>ctl.abort();if(signal)signal.addEventListener('abort',stop,{once:true});
 try{
  let res;
  try{res=await fetch(base.toString(),{headers:{'X-EF-Key':String(key||'')},signal:ctl.signal,cache:'no-store'});}
  catch(e){if(signal&&signal.aborted)throw Error('中止しました');throw Error('中継サーバーに接続できませんでした（URL・通信状態・Workerの公開設定を確認してください）');}
  const body=await res.text();
  if(!res.ok){let m='';try{m=JSON.parse(body).error;}catch(_){}throw Error(m||`中継サーバーがエラーを返しました（${res.status}）`);}
  return body;
 }finally{clearTimeout(timer);if(signal)signal.removeEventListener('abort',stop);}
}
const sleep=(ms,signal)=>new Promise((ok,ng)=>{const t=setTimeout(ok,ms);if(signal)signal.addEventListener('abort',()=>{clearTimeout(t);ng(Error('中止しました'));},{once:true});});
async function importWork({relay,key,url,signal,progress=()=>{},interval=1500,maxEpisodes=3000}){
 const workId=parseWorkUrl(url);
 progress('目次を取得しています…');
 const work=parseWork(await viaRelay(relay,key,'https://kakuyomu.jp/works/'+workId,signal),workId);
 if(work.episodes.length>maxEpisodes)throw Error(`話数が多すぎます（${work.episodes.length}話。上限${maxEpisodes}話）`);
 const chapters=[];
 for(let i=0;i<work.episodes.length;i++){
  const e=work.episodes[i];
  await sleep(interval,signal);                     // 目次の取得直後も含め、毎回1.5秒あける
  if(signal&&signal.aborted)throw Error('中止しました');
  progress(`本文を取得しています… ${i+1}/${work.episodes.length}話「${e.title}」`,i,work.episodes.length);
  let ep;
  try{ep=parseEpisode(await viaRelay(relay,key,`https://kakuyomu.jp/works/${workId}/episodes/${e.id}`,signal));}
  catch(err){if(/中止/.test(err.message))throw err;throw Error(`${i+1}話目「${e.title}」：${err.message}`);}
  const title=(e.chapter?e.chapter+'　':'')+(ep.title||e.title);
  chapters.push({title:title.slice(0,90),text:ep.text+'\n'});
 }
 return{title:work.title,author:work.author,chapters,source:'kakuyomu',via:work.via,workId};
}
g.EbookForgeKakuyomu={parseWorkUrl,parseWork,parseEpisode,toNotation,importWork,ENGINE:'0.7.0'};
})(typeof window!=='undefined'?window:globalThis);
