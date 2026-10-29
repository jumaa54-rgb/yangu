const J=(u,b)=>fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b||{})}).then(async r=>({ok:r.ok,d:await r.json().catch(()=>({}))}));
const afterAuth=r=>{if(!r.ok)return setErr(r.d.error||'Something went wrong. Try again.');me=r.d;profile=null;profileLoadError='';closeM();if(r.d.role==='admin'&&!admin)location.reload();else render()};
let pendingSignup=null;
const signupOtpForm=()=>modal(`<h3>Verify your email</h3><p class="mu">Enter the six-digit code sent to <b>${esc(pendingSignup.email)}</b>. The code expires in 10 minutes.</p><label>Verification code</label><input id="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6"><div class="er" id="er"></div><div class="row"><button class="p" data-act="verifySignup">Create account</button><button data-act="resendSignupOtp">Resend code</button><button data-act="signup">Back</button></div>`);
A.dosignup=async()=>{
 const data={name:val('n'),email:val('e').trim().toLowerCase(),phone:val('ph'),password:$('#pw').value,q:$('#q').value,qa:val('qa')};
 if(!data.name||!/^\S+@\S+\.\S+$/.test(data.email)||data.phone.replace(/\D/g,'').length<9||data.password.length<6||!data.qa)return setErr('Fill all fields correctly (valid email, phone, 6+ character password).');
 let r;try{r=await J('/api/signup/send-code',{email:data.email})}catch{return setErr('Could not send a verification code. Try again.')}
 if(!r.ok)return setErr(r.d.error||'Could not send a verification code.');
 pendingSignup=data;signupOtpForm();
};
A.verifySignup=async()=>{
 if(!pendingSignup)return setErr('Start signing up again to request a verification code.');
 const otp=val('otp');if(!/^\d{6}$/.test(otp))return setErr('Enter the six-digit verification code.');
 let r;try{r=await J('/api/signup',{...pendingSignup,otp})}catch{return setErr('Could not create the account. Try again.')}
 if(!r.ok)return setErr(r.d.error||'Could not create the account.');
 pendingSignup=null;afterAuth(r);
};
A.resendSignupOtp=async()=>{
 if(!pendingSignup)return setErr('Start signing up again to request a verification code.');
 let r;try{r=await J('/api/signup/send-code',{email:pendingSignup.email})}catch{return setErr('Could not send a verification code. Try again.')}
 if(!r.ok)return setErr(r.d.error||'Could not send a verification code.');
 signupOtpForm();setErr('A new verification code was sent.');
};
A.dologin=async()=>afterAuth(await J('/api/login',{email:val('e'),password:$('#pw').value}));
A.fstep=async()=>{const r=await J('/api/forgot',{email:val('e')});if(!r.ok)return setErr(r.d.error||'Try again.');
 modal(`<h3>Reset password</h3><p class="mu">${esc(r.d.q)}</p><input type="hidden" id="e" value="${esc(val('e'))}"><label>Answer</label><input id="qa"><label>New password</label><input id="pw" type="password"><div class="er" id="er"></div><div class="row"><button class="p" data-act="fdone">Reset</button></div>`)};
A.fdone=async()=>{const r=await J('/api/reset',{email:val('e'),qa:val('qa'),password:$('#pw').value});if(!r.ok)return setErr(r.d.error||'Try again.');
 modal('<h3>Password updated \u2713</h3><div class="row"><button class="p" data-act="login">Log in</button></div>')};
A.resetu=async t=>{const u=users.find(x=>x.id===t.dataset.id),r=await J('/api/admin/reset',{email:u.email});alert(r.ok?'Temporary password for '+u.email+': '+r.d.temp:'Failed')};
A.profile=async()=>{view='profile';profile=null;profileLoadError='';render();try{const r=await fetch('/api/profile'),d=await r.json();if(!r.ok)throw new Error(d.error||'Could not load profile.');profile=d;recoveryEmailTarget=d.recoveryEmail||'';render()}catch(x){profileLoadError=x.message||'Could not load profile.';render()}};
A.saveProfile=async()=>{
 let r;try{r=await J('/api/profile/update',{name:val('profileName'),recoveryPhone:val('recoveryPhone'),password:$('#profilePassword').value})}catch{const m=$('#profileMessage');if(m)m.textContent='Could not save profile. Please try again.';return}
 if(!r.ok){const m=$('#profileMessage');if(m)m.textContent=r.d.error||'Could not save profile.';return}
 profile=r.d;recoveryEmailTarget=profile.recoveryEmail||'';setMe({...me,name:profile.name});render();
 const m=$('#profileMessage');if(m)m.textContent='Profile saved.';
};
A.sendRecoveryEmailCode=async()=>{
 recoveryEmailTarget=val('recoveryEmail').toLowerCase();
 if(recoveryEmailTarget===profile.recoveryEmail){const m=$('#recoveryEmailMessage');if(m)m.textContent='This recovery email is already verified.';return}
 let r;try{r=await J('/api/profile/recovery-email/send-code',{email:recoveryEmailTarget,password:$('#recoveryEmailPassword').value})}catch{const m=$('#recoveryEmailMessage');if(m)m.textContent='Could not send verification code. Please try again.';return}
 const m=$('#recoveryEmailMessage');
 if(!r.ok){if(m)m.textContent=r.d.error||'Could not send verification code.';return}
 profileEmailPending=true;render();const msg=$('#recoveryEmailMessage');if(msg)msg.textContent='Verification code sent. It expires in 10 minutes.';
};
A.verifyRecoveryEmail=async()=>{
 let r;try{r=await J('/api/profile/recovery-email/verify',{email:recoveryEmailTarget,otp:val('recoveryEmailOtp')})}catch{const m=$('#recoveryEmailMessage');if(m)m.textContent='Could not verify recovery email. Please try again.';return}
 if(!r.ok){const m=$('#recoveryEmailMessage');if(m)m.textContent=r.d.error||'Could not verify recovery email.';return}
 profile=r.d;recoveryEmailTarget=profile.recoveryEmail||'';profileEmailPending=false;render();
 const m=$('#recoveryEmailMessage');if(m)m.textContent='Recovery email verified and saved.';
};
A.removeRecoveryEmail=async()=>{
 if(!confirm('Remove your recovery email?'))return;
 let r;try{r=await J('/api/profile/recovery-email/remove',{password:$('#recoveryEmailPassword').value})}catch{const m=$('#recoveryEmailMessage');if(m)m.textContent='Could not remove recovery email. Please try again.';return}
 if(!r.ok){const m=$('#recoveryEmailMessage');if(m)m.textContent=r.d.error||'Could not remove recovery email.';return}
 profile=r.d;recoveryEmailTarget='';profileEmailPending=false;render();
 const m=$('#recoveryEmailMessage');if(m)m.textContent='Recovery email removed.';
};
A.uploadProfilePhoto=async file=>{
 const m=$('#profileMessage');
 try{
  const image=await shrink(file);if(image.size>3e6)throw new Error('Photo is too large. Choose a smaller image.');
  const form=new FormData();form.append('file',image,'profile.jpg');
  const r=await fetch('/api/profile/photo',{method:'POST',body:form}),d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||'Could not upload profile photo.');
  profile.avatarId=d.avatarId;render();
 }catch(x){if(m)m.textContent=x.message||'Could not upload profile photo.'}
};
A.removeProfilePhoto=async()=>{
 let r,d;try{r=await fetch('/api/profile/photo',{method:'DELETE'});d=await r.json().catch(()=>({}))}catch{const m=$('#profileMessage');if(m)m.textContent='Could not remove profile photo. Please try again.';return}
 if(!r.ok){const m=$('#profileMessage');if(m)m.textContent=d.error||'Could not remove profile photo.';return}
 profile.avatarId='';render();
};
{const o=A.logout;A.logout=()=>{J('/api/logout');profile=null;profileEmailPending=false;recoveryEmailTarget='';o()}}
fetch('/api/me').then(r=>r.json()).then(u=>{if(u){me={email:u.email,name:u.name,phone:u.phone};render()}}).catch(()=>{});
