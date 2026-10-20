'use strict';
const $ = id => document.getElementById(id);
$('file').addEventListener('change', async e => {
 const f=e.target.files[0]; if(!f)return;
 $('body').value=await f.text(); $('title').value=f.name.replace(/\.txt$/i,'');
});
const te=new TextEncoder();
function fix(s,n){const out=new Uint8Array(n);const str=String(s||'');let j=0;for(const ch of str){const b=te.encode(ch);if(j+b.length>=n)break;out.set(b,j);j+=b.length;}return out;}
function md5(data){
 // Compact standalone MD5 for XTC page checksum (not used for security).
 const n=data.length, len=(((n+8)>>>6)+1)*64, b=new Uint8Array(len);b.set(data);b[n]=128;
 const dv=new DataView(b.buffer);dv.setUint32(len-8,(n*8)>>>0,true);dv.setUint32(len-4,Math.floor(n/0x20000000),true);
 let a0=0x67452301,b0=0xefcdab89,c0=0x98badcfe,d0=0x10325476;
 const shift=[7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21];
 const k=Array.from({length:64},(_,i)=>Math.floor(Math.abs(Math.sin(i+1))*4294967296)>>>0);
 for(let p=0;p<len;p+=64){let a=a0,bb=b0,c=c0,d=d0;
 for(let i=0;i<64;i++){let f,g,s;if(i<16){f=(bb&c)|(~bb&d);g=i;s=shift[i%4];}else if(i<32){f=(d&bb)|(~d&c);g=(5*i+1)%16;s=shift[4+i%4];}else if(i<48){f=bb^c^d;g=(3*i+5)%16;s=shift[8+i%4];}else{f=c^(bb|~d);g=(7*i)%16;s=shift[12+i%4];}
 const t=(a+f+k[i]+dv.getUint32(p+g*4,true))>>>0;a=d;d=c;c=bb;bb=(bb+((t<<s)|(t>>>(32-s))))>>>0;
 }a0=(a0+a)>>>0;b0=(b0+bb)>>>0;c0=(c0+c)>>>0;d0=(d0+d)>>>0;
 }const out=new Uint8Array(16),v=new DataView(out.buffer);[a0,b0,c0,d0].forEach((x,i)=>v.setUint32(i*4,x,true));return out;
}
function packPage(canvas,W,H){
 const ctx=canvas.getContext('2d',{willReadFrequently:true}),pixels=ctx.getImageData(0,0,W,H).data;
 const row=Math.ceil(W/8),out=new Uint8Array(row*H);out.fill(255);
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4;
 const lum=(pixels[i]*299+pixels[i+1]*587+pixels[i+2]*114)/1000;
 if(lum<128)out[y*row+(x>>3)] &= ~(128>>(x&7));
 }return out;
}
function render(text,W,H,fontSize){
 const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
 const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);
 ctx.fillStyle='#000';ctx.font=`${fontSize}px serif`;ctx.textBaseline='top';
 const margin=22,step=Math.ceil(fontSize*1.5),maxY=H-margin-step;
 let y=margin, pages=[],count=0;
 function finish(){pages.push(packPage(canvas,W,H));ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);ctx.fillStyle='#000';y=margin;}
 for(const para of text.replace(/\r\n?/g,'\n').split('\n')){
  if(!para.trim()){y+=step;if(y>maxY)finish();continue;}
  let line='';for(const ch of para){const trial=line+ch;if(ctx.measureText(trial).width>W-2*margin && line){ctx.fillText(line,margin,y);y+=step;count++;if(y>maxY)finish();line=ch;}else line=trial;}
  if(line){ctx.fillText(line,margin,y);y+=step;count++;if(y>maxY)finish();}
 }
 if(y>margin||!pages.length)finish();return pages;
}
function buildXtc(pages,W,H,title,author){
 const N=pages.length;if(N>65535)throw Error('ページ数が65535を超えています');
 const meta=256,head=56,entry=16,ph=22,payload=pages[0].length;
 const dataOff=head+meta+entry*N,pageSize=ph+payload,total=dataOff+N*pageSize;
 if(total>500*1024*1024)throw Error('500MBを超えるため中止しました');
 const b=new Uint8Array(total),v=new DataView(b.buffer);
 b.set([88,84,67,0],0);b[4]=1;b[5]=0;v.setUint16(6,N,true);
 b[8]=0;b[9]=1;b[10]=0;b[11]=0;v.setUint32(12,1,true);
 v.setBigUint64(16,BigInt(head),true);v.setBigUint64(24,BigInt(head+meta),true);
 v.setBigUint64(32,BigInt(dataOff),true);
 b.set(fix(title,128),head);b.set(fix(author,64),head+128);
 b.set(fix('EbookForge Web',32),head+192);b.set(fix('ja',16),head+224);
 for(let i=0;i<N;i++){
 const o=head+meta+i*entry, po=dataOff+i*pageSize;
 v.setBigUint64(o,BigInt(po),true);v.setUint32(o+8,pageSize,true);
 v.setUint16(o+12,W,true);v.setUint16(o+14,H,true);
 b.set([88,84,71,0],po);v.setUint16(po+4,W,true);v.setUint16(po+6,H,true);
 v.setUint32(po+10,payload,true);b.set(md5(pages[i]).slice(0,8),po+14);b.set(pages[i],po+ph);
 }return b;
}
$('convert').addEventListener('click',async()=>{
 const btn=$('convert'),status=$('status');btn.disabled=true;
 try{
 const text=$('body').value;if(!text.trim())throw Error('本文を入力してください');
 const [W,H]=$('device').value==='X3'?[528,792]:[480,800];
 status.textContent='ページを生成しています…';await new Promise(r=>setTimeout(r,10));
 const pages=render(text,W,H,Number($('size').value));
 const bytes=buildXtc(pages,W,H,$('title').value,$('author').value);
 const blob=new Blob([bytes],{type:'application/octet-stream'}),url=URL.createObjectURL(blob);
 const a=document.createElement('a');a.href=url;a.download=($('title').value||'ebook').replace(/[\\/:*?"<>|]/g,'_')+'.xtc';a.click();
 setTimeout(()=>URL.revokeObjectURL(url),30000);
 status.textContent=`${pages.length}ページのXTCを作成しました（${(bytes.length/1024/1024).toFixed(1)} MB）。端末へは手動で転送してください。`;
 }catch(e){status.textContent='エラー: '+e.message;}finally{btn.disabled=false;}
});
