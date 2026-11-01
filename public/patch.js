const J=(u,b)=>fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b||{})}).then(async r=>({ok:r.ok,d:await r.json().catch(()=>({}))}));
const SUPPORT_EMAIL='jumaaustine544@gmail.com',SUPPORT_PHONE='+254769673466';
const supportLinks=()=>`<p class="mu">Need help? First administrator: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> · <a href="tel:${SUPPORT_PHONE}">Call ${SUPPORT_PHONE}</a> · <a href="https://wa.me/${SUPPORT_PHONE.replace(/\D/g,'')}">WhatsApp</a></p>`;
const afterAuth=r=>{if(!r.ok)return setErr(r.d.error||'Something went wrong. Try again.');me=r.d;profile=null;profileLoadError='';closeM();if(r.d.role==='admin'&&!admin)location.reload();else render()};
const TERMS_VERSION='2026-11-01';
const otpFields=group=>`<div class="otp-digits"><input id="${group}Otp" class="otp-entry" data-otp-group="${group}" type="text" inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code" maxlength="6" placeholder="000000" aria-label="Six-digit verification code"></div>`;
const otpValue=group=>document.querySelector(`[data-otp-group="${group}"]`)?.value||'';
let signupPendingEmail='',signupVerifiedEmail='';
const openSignup=A.signup;
A.signup=()=>{signupPendingEmail='';signupVerifiedEmail='';return openSignup()};
A.sendSignupCode=async()=>{
 const email=val('e').toLowerCase(),status=$('#signupEmailStatus'),wrap=$('#signupOtpWrap');
 if(!validEmail(email)){if(status)status.textContent='Enter a valid email address first.';return}
 if(signupVerifiedEmail===email){if(status)status.textContent='This email is already verified.';return}
 if(status)status.textContent='Sending verification code…';
 let r;try{r=await J('/api/signup/send-code',{email})}catch{if(status)status.textContent='Could not send the code. Check your connection and try again.';return}
 if(!r.ok){if(status)status.textContent=r.d.error||'Could not send the verification code.';return}
 signupPendingEmail=email;if(wrap)wrap.hidden=false;
 if(status)status.textContent='Code sent. Check your inbox and spam folder; it expires in 10 minutes.';
};
A.verifySignupCode=async()=>{
 const email=val('e').toLowerCase(),code=val('signupOtp'),status=$('#signupEmailStatus');
 if(!signupPendingEmail||signupPendingEmail!==email){if(status)status.textContent='Send a code to this email address first.';return}
 if(!/^\d{6}$/.test(code)){if(status)status.textContent='Enter the six-digit verification code.';return}
 if(status)status.textContent='Verifying email…';
 let r;try{r=await J('/api/signup/verify-code',{email,code})}catch{if(status)status.textContent='Could not verify the code. Check your connection and try again.';return}
 if(!r.ok){if(status)status.textContent=r.d.error||'Could not verify this email.';return}
 signupVerifiedEmail=email;signupPendingEmail='';
 const wrap=$('#signupOtpWrap');if(wrap)wrap.hidden=true;
 if(status)status.textContent='Email verified. You can finish creating your account.';
};
A.dosignup=async()=>{
 const data={name:val('n'),email:val('e').trim().toLowerCase(),phone:val('ph'),password:$('#pw').value,q:$('#q').value,qa:val('qa'),termsAccepted:$('#termsAccepted')?.checked===true,termsVersion:TERMS_VERSION};
 if(!validEmail(data.email))return setErr('Enter a valid email address (for example, name@example.com).');
 if(signupVerifiedEmail!==data.email)return setErr('Verify your email address before creating an account.');
 if(!data.name||data.phone.replace(/\D/g,'').length<9||data.password.length<6||!data.qa)return setErr('Fill all fields correctly (valid phone, 6+ character password, and recovery answer).');
 if(!data.termsAccepted)return setErr('Please read and accept the Terms and Conditions to create your account.');
 let r;try{r=await J('/api/signup',data)}catch{const e=$('#er');if(e)e.innerHTML=`Could not create the account. Try again. ${supportLinks()}`;return}
 if(!r.ok){
  if((r.d.error||'').includes('Verify your email address')){
   signupVerifiedEmail='';signupPendingEmail=data.email;
   const wrap=$('#signupOtpWrap'),status=$('#signupEmailStatus');
   if(wrap)wrap.hidden=false;
   if(status)status.textContent='The code expired. Request a new code and verify this email again.';
  }
  const e=$('#er');if(e)e.innerHTML=`${esc(r.d.error||'Could not create the account.')} ${supportLinks()}`;return
 }
 afterAuth(r);
};
document.addEventListener('input',e=>{
 if(e.target.id==='signupOtp'){e.target.value=e.target.value.replace(/\D/g,'').slice(0,6);return}
 if(e.target.id!=='e')return;
 const value=e.target.value.trim(),valid=validEmail(value),message=$('#emailValidation');
 if(message){e.target.setAttribute('aria-invalid',String(!!value&&!valid));message.textContent=value&&!valid?'Enter a valid email address, such as name@example.com.':''}
 if($('#signupEmailStatus')&&signupVerifiedEmail&&value.toLowerCase()!==signupVerifiedEmail){
  signupVerifiedEmail='';signupPendingEmail='';
  $('#signupEmailStatus').textContent='Email changed; verify this address before signing up.';
  $('#signupOtpWrap').hidden=true;
 }
});
A.help=()=>modal(`<h3>Need help?</h3><p>For sign-up or account problems, contact the first administrator.</p><div class="row"><a class="btn p" href="mailto:${SUPPORT_EMAIL}">Email ${SUPPORT_EMAIL}</a><a class="btn" href="tel:${SUPPORT_PHONE}">Call ${SUPPORT_PHONE}</a><a class="btn" href="https://wa.me/${SUPPORT_PHONE.replace(/\D/g,'')}">WhatsApp</a></div><p class="mu">For product suggestions, use <b>✨ Ask AI</b>.</p>`);
A.dologin=async()=>afterAuth(await J('/api/login',{email:val('e'),password:$('#pw').value}));
A.fstep=async()=>{const r=await J('/api/forgot',{email:val('e')});if(!r.ok)return setErr(r.d.error||'Try again.');
 modal(`<h3>Reset password</h3><p class="mu">${esc(r.d.q)}</p><input type="hidden" id="e" value="${esc(val('e'))}"><label>Answer</label><input id="qa"><label>New password</label><input id="pw" type="password"><div class="er" id="er"></div><div class="row"><button class="p" data-act="fdone">Reset</button></div>`)};
A.fdone=async()=>{const r=await J('/api/reset',{email:val('e'),qa:val('qa'),password:$('#pw').value});if(!r.ok)return setErr(r.d.error||'Try again.');
 modal('<h3>Password updated \u2713</h3><div class="row"><button class="p" data-act="login">Log in</button></div>')};
A.resetu=async t=>{const u=users.find(x=>x.id===t.dataset.id),r=await J('/api/admin/reset',{email:u.email});alert(r.ok?'Temporary password for '+u.email+': '+r.d.temp:'Failed')};
A.profile=async()=>{view='profile';profile=null;profileLoadError='';render();try{const r=await fetch('/api/profile'),d=await r.json();if(!r.ok)throw new Error(d.error||'Could not load profile.');profile=d;me={...me,avatarId:d.avatarId};recoveryEmailTarget=d.recoveryEmail||'';render()}catch(x){profileLoadError=x.message||'Could not load profile.';render()}};
A.saveProfile=async()=>{
 let r;try{r=await J('/api/profile/update',{name:val('profileName'),recoveryPhone:val('recoveryPhone'),password:$('#profilePassword').value})}catch{const m=$('#profileMessage');if(m)m.textContent='Could not save profile. Please try again.';return}
 if(!r.ok){const m=$('#profileMessage');if(m)m.textContent=r.d.error||'Could not save profile.';return}
 profile=r.d;recoveryEmailTarget=profile.recoveryEmail||'';setMe({...me,name:profile.name});render();
 const m=$('#profileMessage');if(m)m.textContent='Profile saved.';
};
A.sendRecoveryEmailCode=async()=>{
 recoveryEmailTarget=val('recoveryEmail').toLowerCase();
 if(recoveryEmailTarget===profile.recoveryEmail){const m=$('#recoveryEmailMessage');if(m)m.textContent='This recovery email is already verified.';return}
 let r;try{r=await J('/api/profile/recovery-email/send-code',{email:recoveryEmailTarget,password:$('#recoveryEmailPassword').value})}catch{const m=$('#recoveryEmailMessage');if(m)m.innerHTML=`Could not send verification code. Please try again. ${supportLinks()}`;return}
 const m=$('#recoveryEmailMessage');
 if(!r.ok){if(m)m.innerHTML=`${esc(r.d.error||'Could not send verification code.')} ${supportLinks()}`;return}
 profileEmailPending=true;render();const msg=$('#recoveryEmailMessage');if(msg)msg.textContent='Verification code sent. It expires in 10 minutes.';
};
A.verifyRecoveryEmail=async()=>{
 let r;try{r=await J('/api/profile/recovery-email/verify',{email:recoveryEmailTarget,otp:otpValue('recoveryEmail')})}catch{const m=$('#recoveryEmailMessage');if(m)m.innerHTML=`Could not verify recovery email. Please try again. ${supportLinks()}`;return}
 if(!r.ok){const m=$('#recoveryEmailMessage');if(m)m.innerHTML=`${esc(r.d.error||'Could not verify recovery email.')} ${supportLinks()}`;return}
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
  profile.avatarId=d.avatarId;me={...me,avatarId:d.avatarId};render();
 }catch(x){if(m)m.textContent=x.message||'Could not upload profile photo.'}
};
A.removeProfilePhoto=async()=>{
 let r,d;try{r=await fetch('/api/profile/photo',{method:'DELETE'});d=await r.json().catch(()=>({}))}catch{const m=$('#profileMessage');if(m)m.textContent='Could not remove profile photo. Please try again.';return}
 if(!r.ok){const m=$('#profileMessage');if(m)m.textContent=d.error||'Could not remove profile photo.';return}
 profile.avatarId='';me={...me,avatarId:''};render();
};
{const o=A.logout;A.logout=()=>{J('/api/logout');profile=null;profileEmailPending=false;recoveryEmailTarget='';o()}}
fetch('/api/me').then(r=>r.json()).then(u=>{if(u){me={email:u.email,name:u.name,phone:u.phone,avatarId:u.avatarId||''};render()}}).catch(()=>{});
document.addEventListener('input',e=>{
 const input=e.target.closest('[data-otp-group]');if(!input)return;
 input.value=input.value.replace(/\D/g,'').slice(0,6);
});
document.addEventListener('paste',e=>{
 const input=e.target.closest('[data-otp-group]');if(!input)return;
 const digits=e.clipboardData.getData('text').replace(/\D/g,'').slice(0,6);if(!digits)return;
 e.preventDefault();
 input.value=digits;
});
