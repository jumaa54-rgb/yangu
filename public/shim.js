(()=>{let role='';
const api=async(u,o)=>{const r=await fetch(u,o);if(!r.ok)throw new Error(r.status);return r.json()};
const js=(m,b)=>({method:m,headers:{'content-type':'application/json'},body:JSON.stringify(b)});
const poll=(get,cb)=>{let last;const t=async()=>{try{const s=await get(),k=JSON.stringify(s.docs?s.docs.map(d=>[d.id,d.data()]):s.data());if(k!==last){last=k;cb(s)}}catch(e){}};t();setInterval(t,5000)};
const docRef=(c,id)=>{const u=`/api/c/${c}/${encodeURIComponent(id)}`,r={
 async get(){try{const x=await api(u);return{exists:true,id,data:()=>x.data}}catch(e){return{exists:false,id,data:()=>null}}},
 set:d=>api(u,js('PUT',d)),update:d=>api(u,js('PATCH',d)),delete:()=>api(u,{method:'DELETE'}),
 onSnapshot:cb=>poll(()=>r.get(),cb)};return r};
const colRef=c=>({doc:id=>docRef(c,id),
 onSnapshot:cb=>poll(async()=>({docs:(await api('/api/c/'+c)).map(x=>({id:x.id,data:()=>x.data}))}),cb)});
const db={collection:colRef,doc:p=>{const[c,id]=p.split('/');return docRef(c,id)}};
window.claude={async use(n){
 if(n==='db')return db;
 if(n==='user'){try{role=(await api('/api/me'))?.role||''}catch(e){}return{canEdit:()=>role==='admin',isOwner:()=>role==='admin'}}
 if(n==='assets')return{upload:b=>{const f=new FormData();f.append('file',b,'p.jpg');return api('/api/upload',{method:'POST',body:f})}};
 return null}}})();
