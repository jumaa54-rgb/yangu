const J=(u,b)=>fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b||{})}).then(async r=>({ok:r.ok,d:await r.json().catch(()=>({}))}));
const afterAuth=r=>{if(!r.ok)return setErr(r.d.error||'Something went wrong. Try again.');me=r.d;closeM();if(r.d.role==='admin'&&!admin)location.reload();else render()};
A.dosignup=async()=>afterAuth(await J('/api/signup',{name:val('n'),email:val('e'),phone:val('ph'),password:$('#pw').value,q:$('#q').value,qa:val('qa')}));
A.dologin=async()=>afterAuth(await J('/api/login',{email:val('e'),password:$('#pw').value}));
A.fstep=async()=>{const r=await J('/api/forgot',{email:val('e')});if(!r.ok)return setErr(r.d.error||'Try again.');
 modal(`<h3>Reset password</h3><p class="mu">${esc(r.d.q)}</p><input type="hidden" id="e" value="${esc(val('e'))}"><label>Answer</label><input id="qa"><label>New password</label><input id="pw" type="password"><div class="er" id="er"></div><div class="row"><button class="p" data-act="fdone">Reset</button></div>`)};
A.fdone=async()=>{const r=await J('/api/reset',{email:val('e'),qa:val('qa'),password:$('#pw').value});if(!r.ok)return setErr(r.d.error||'Try again.');
 modal('<h3>Password updated \u2713</h3><div class="row"><button class="p" data-act="login">Log in</button></div>')};
A.resetu=async t=>{const u=users.find(x=>x.id===t.dataset.id),r=await J('/api/admin/reset',{email:u.email});alert(r.ok?'Temporary password for '+u.email+': '+r.d.temp:'Failed')};
{const o=A.logout;A.logout=()=>{J('/api/logout');o()}}
fetch('/api/me').then(r=>r.json()).then(u=>{if(u){me={email:u.email,name:u.name,phone:u.phone};render()}}).catch(()=>{});
