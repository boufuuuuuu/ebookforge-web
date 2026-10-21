/* Local Aozora Bunko public works catalog parser */
(function(g){
'use strict';
function csvParse(text){
 let rows=[],row=[],s='',inQuotes=false;
 text=text.replace(/^\ufeff/,'');
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(inQuotes){if(ch==='"'&&text[i+1]==='"'){s+='"';i++;}else if(ch==='"')inQuotes=false;else s+=ch;}
  else if(ch==='"'&&s==='')inQuotes=true;
  else if(ch===','){row.push(s);s='';}
  else if(ch==='\r'||ch==='\n'){
   if(ch==='\r'&&text[i+1]==='\n')i++;
   row.push(s);if(row.some(x=>x))rows.push(row);row=[];s='';
   if(rows.length>125000)throw Error('作品一覧の行数が多すぎます');
  }else s+=ch;
 }
 if(inQuotes)throw Error('CSVの引用符が閉じられていません');
 if(s||row.length){row.push(s);rows.push(row);}
 return rows;
}
function indexWorks(rows){
 const head=rows[0];if(!head||!['作品名','作品ID','図書カードURL'].every(x=>head.includes(x)))
 throw Error('青空文庫の拡充CSVではありません');
 const ix=name=>head.indexOf(name),get=(row,k)=>row[ix(k)]||'';
 let seen=new Set(),works=[];
 for(const r of rows.slice(1)){
  const id=get(r,'作品ID'),title=get(r,'作品名');
  if(!id||!title||seen.has(id))continue;
  if(ix('作品著作権フラグ')>=0&&get(r,'作品著作権フラグ')!=='なし')continue;
  if(ix('人物著作権フラグ')>=0&&get(r,'人物著作権フラグ')!=='なし')continue;
  const url=get(r,'図書カードURL');
  try{const u=new URL(url);
   if(!['http:','https:'].includes(u.protocol)||!['www.aozora.gr.jp','aozora.gr.jp'].includes(u.hostname))continue;
  }catch(_){continue;}
  seen.add(id);const u=new URL(url);works.push({id,title,author:(get(r,'姓')+' '+get(r,'名')).trim(),url:'https://www.aozora.gr.jp'+u.pathname});
 }
 return works;
}
async function load(bytes){
 bytes=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
 let raw=bytes;
 if(bytes[0]===0x50&&bytes[1]===0x4b){
  const entries=g.EbookForgeEpub.readZIP(bytes,false);
  const csv=entries.find(e=>/\.csv$/i.test(e.name));if(!csv)throw Error('CSVが見つかりません');
  raw=await g.EbookForgeEpub.unpack(csv);
 }
 return indexWorks(csvParse(new TextDecoder('utf-8',{fatal:true}).decode(raw)));
}
function search(works,query){
 const words=String(query).toLocaleLowerCase('ja-JP').trim().split(/\s+/).filter(Boolean);
 if(!words.length)return [];
 return works.filter(w=>words.every(t=>(w.title+' '+w.author).toLocaleLowerCase('ja-JP').includes(t))).slice(0,35);
}
g.EbookForgeAozora={csvParse,indexWorks,load,search};
})(typeof window!=='undefined'?window:globalThis);
