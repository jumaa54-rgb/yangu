const express=require('express'),{Pool}=require('pg'),bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken'),cp=require('cookie-parser'),multer=require('multer'),path=require('path'),crypto=require('crypto'),nodemailer=require('nodemailer');
const SECRET=process.env.JWT_SECRET;if(!SECRET)throw new Error('Set JWT_SECRET');
const norm=e=>String(e||'').trim().toLowerCase();
const validEmail=value=>{
 if(typeof value!=='string'||value.length>254)return false;
 const at=value.lastIndexOf('@');
 if(at<1||at!==value.indexOf('@'))return false;
 const local=value.slice(0,at),domain=value.slice(at+1);
 if(local.length>64||domain.length>253||!/^[-A-Za-z0-9!#$%&'*+/=?^_`{|}~]+(?:\.[-A-Za-z0-9!#$%&'*+/=?^_`{|}~]+)*$/.test(local))return false;
 const labels=domain.split('.');
 return labels.length>1&&labels.every(label=>label.length<=63&&/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label))&&labels[labels.length-1].length>=2&&/[A-Za-z]/.test(labels[labels.length-1]);
};
const prod=process.env.NODE_ENV==='production';
const SMTP_HOST=process.env.SMTP_HOST,SMTP_PORT=Number(process.env.SMTP_PORT||587),SMTP_USER=process.env.SMTP_USER,SMTP_PASS=process.env.SMTP_PASS,SMTP_FROM=process.env.SMTP_FROM||SMTP_USER;
const mail=SMTP_HOST&&SMTP_USER&&SMTP_PASS&&SMTP_FROM?nodemailer.createTransport({host:SMTP_HOST,port:SMTP_PORT,secure:SMTP_PORT===465,auth:{user:SMTP_USER,pass:SMTP_PASS}}):null;
const PUBLIC_URL=process.env.PUBLIC_URL||process.env.RENDER_EXTERNAL_URL||'http://localhost:3000';
const TERMS_VERSION='2026-10-30';
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:prod?{rejectUnauthorized:false}:false});
const q=(s,p)=>pool.query(s,p),hex=e=>Buffer.from(e).toString('hex');
const app=express();app.set('trust proxy',1);app.use(express.json({limit:'1mb'}),cp());
const up=multer({storage:multer.memoryStorage(),limits:{fileSize:3e6}});
const videoUp=multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024}});
const sign=(res,e)=>res.cookie('t',jwt.sign({e},SECRET,{expiresIn:'30d'}),{httpOnly:true,sameSite:'lax',secure:prod,maxAge:2592e6});
const pub=u=>({email:u.email,name:u.name,phone:u.phone,role:u.role,avatarId:u.avatarId||''}),adm=u=>u&&u.role==='admin';
const getUser=async e=>(await q("select data from docs where coll='users' and id=$1",[hex(e)])).rows[0]?.data;
const otpHash=code=>crypto.createHmac('sha256',SECRET).update(code).digest('hex');
app.use(async(req,res,next)=>{try{req.u=await getUser(jwt.verify(req.cookies.t,SECRET).e)||null}catch{req.u=null}next()});

app.post('/api/signup/send-code',async(req,res)=>{
 const e=norm(req.body.email);
 if(!/^\S+@\S+\.\S+$/.test(e))return res.status(400).json({error:'Enter a valid email address.'});
 if((await q("select 1 from docs where coll='users' and (lower(data->>'email')=$1 or lower(data->>'recoveryEmail')=$1) limit 1",[e])).rowCount)return res.status(409).json({error:'This email is already in use by an account.'});
 if(!mail)return res.status(503).json({error:'Email verification is not configured. Contact the site administrator.'});
 const code=String(crypto.randomInt(0,1000000)).padStart(6,'0'),c=await pool.connect();
 try{
  await c.query('begin');
  await c.query('select pg_advisory_xact_lock(hashtext($1)::bigint)',[e]);
  if((await c.query("select 1 from docs where coll='users' and (id=$1 or lower(data->>'recoveryEmail')=$2) limit 1",[hex(e),e])).rowCount){
   await c.query('rollback');return res.status(409).json({error:'This email is already in use by an account.'});
  }
  const prev=(await c.query('select sent_at from signup_otps where email=$1',[e])).rows[0];
  if(prev&&Date.now()-new Date(prev.sent_at).getTime()<60000){
   await c.query('rollback');return res.status(429).json({error:'Please wait a minute before requesting another code.'});
  }
  const linkToken=crypto.randomBytes(32).toString('base64url'),verifyUrl=new URL('/',PUBLIC_URL);
  verifyUrl.hash=new URLSearchParams({verify:linkToken}).toString();
  await mail.sendMail({
   from:SMTP_FROM,to:e,subject:'Verify your Yangu email address',
   text:`Your Yangu verification code is ${code}. It expires in 10 minutes.\n\nOr verify your email and continue signing up by opening this link:\n${verifyUrl}`,
   html:`<p>Your Yangu verification code is <strong>${code}</strong>. It expires in 10 minutes.</p><p>Or <a href="${verifyUrl}">verify your email and continue signing up</a>.</p>`
  });
  await c.query(`insert into signup_otps(email,code_hash,link_token_hash,verified_at,expires_at,sent_at,attempts)
   values($1,$2,$3,null,now()+interval '10 minutes',now(),0)
   on conflict(email) do update set code_hash=excluded.code_hash,link_token_hash=excluded.link_token_hash,verified_at=null,expires_at=excluded.expires_at,sent_at=excluded.sent_at,attempts=0`,
   [e,otpHash(code),otpHash(linkToken)]);
  await c.query('commit');res.json({ok:true});
 }catch(x){await c.query('rollback');console.error(x);res.status(503).json({error:'Could not send a verification code. Check the email address or try again later.'})}
 finally{c.release()}});

app.post('/api/signup/verify-link',async(req,res)=>{
 const token=String(req.body.token||'');
 if(!/^[A-Za-z0-9_-]{40,50}$/.test(token))return res.status(400).json({error:'This verification link is invalid or expired. Request a new code.'});
 const c=await pool.connect();
 try{
  await c.query('begin');
  const verification=(await c.query('select email,expires_at from signup_otps where link_token_hash=$1 for update',[otpHash(token)])).rows[0];
  if(!verification||new Date(verification.expires_at).getTime()<=Date.now()){
   await c.query('rollback');return res.status(400).json({error:'This verification link is invalid or expired. Request a new code.'});
  }
  if((await c.query("select 1 from docs where coll='users' and (id=$1 or lower(data->>'recoveryEmail')=$2) limit 1",[hex(verification.email),verification.email])).rowCount){
   await c.query('delete from signup_otps where email=$1',[verification.email]);await c.query('commit');
   return res.status(409).json({error:'This email is already in use by an account.'});
  }
  await c.query('update signup_otps set verified_at=now() where email=$1',[verification.email]);
  await c.query('commit');res.json({ok:true,email:verification.email});
 }catch(x){await c.query('rollback');console.error(x);res.status(500).json({error:'Could not verify the email link.'})}
 finally{c.release()}});

app.post('/api/signup',async(req,res)=>{
 const{name,email,phone,password,q:qn,qa,termsAccepted,termsVersion}=req.body,e=norm(email);
 if(!validEmail(e))return res.status(400).json({error:'Enter a valid email address (for example, name@example.com).'});
 if(!name||String(phone||'').replace(/\D/g,'').length<9||String(password||'').length<6||!qa)return res.status(400).json({error:'Fill all fields correctly (valid phone, 6+ character password, and recovery answer).'});
 if(termsAccepted!==true||termsVersion!==TERMS_VERSION)return res.status(400).json({error:'Read and accept the current Terms and Conditions before creating an account.'});
 const c=await pool.connect();
 try{
  await c.query('begin');
  await c.query("select pg_advisory_xact_lock(hashtext('yangu-admin-accounts')::bigint)");
  await c.query('select pg_advisory_xact_lock(hashtext($1)::bigint)',[e]);
  if((await c.query("select 1 from docs where coll='users' and (id=$1 or lower(data->>'recoveryEmail')=$2) limit 1",[hex(e),e])).rowCount){
   await c.query('commit');
   return res.status(409).json({error:'This email is already in use by an account.'});
  }
  const slots=(await c.query('select slot from admin_slots')).rows.map(row=>row.slot),adminSlot=[1,2].find(slot=>!slots.includes(slot));
  const role=adminSlot?'admin':'seller';
  const ins=await c.query("insert into docs values('users',$1,$2) on conflict do nothing returning 1",[hex(e),{email:e,emailVerified:false,termsAcceptedAt:new Date().toISOString(),termsVersion:TERMS_VERSION,name:String(name).slice(0,80),phone:String(phone).slice(0,30),hash:await bcrypt.hash(String(password),10),q:qn,qah:await bcrypt.hash(String(qa).toLowerCase().trim(),10),role,created:Date.now()}]);
  if(!ins.rowCount){await c.query('commit');return res.status(409).json({error:'This email already has an account. Please log in.'})}
  if(adminSlot)await c.query('insert into admin_slots(slot,user_id) values($1,$2)',[adminSlot,hex(e)]);
  await c.query('commit');sign(res,e);res.json(pub(await getUser(e)));
 }catch(x){await c.query('rollback');console.error(x);res.status(500).json({error:'Server error'})}finally{c.release()}});
app.post('/api/login',async(req,res)=>{const e=norm(req.body.email),u=await getUser(e);
 if(!u)return res.status(404).json({error:'No account with that email.'});
 if(!await bcrypt.compare(String(req.body.password||''),u.hash))return res.status(401).json({error:'Wrong password.'});
 sign(res,e);res.json(pub(u))});
app.post('/api/logout',(req,res)=>{res.clearCookie('t');res.json({ok:1})});
app.get('/api/me',(req,res)=>res.json(req.u?pub(req.u):null));
const profileOf=u=>({name:u.name,email:u.email,emailVerified:u.emailVerified===true,phone:u.phone,recoveryEmail:u.recoveryEmail||'',recoveryPhone:u.recoveryPhone||'',avatarId:u.avatarId||''});
app.get('/api/profile',(req,res)=>req.u?res.json(profileOf(req.u)):res.sendStatus(401));
app.post('/api/profile/update',async(req,res)=>{
 if(!req.u)return res.sendStatus(401);
 const name=String(req.body.name||'').trim(),phone=String(req.body.recoveryPhone||'').trim();
 if(!name||name.length>80||(phone&&phone.replace(/\D/g,'').length<9)||phone.length>30)return res.status(400).json({error:'Enter a name and a valid recovery phone number, or leave the recovery phone blank.'});
 if(!await bcrypt.compare(String(req.body.password||''),req.u.hash))return res.status(401).json({error:'Your current password is incorrect.'});
 await q("update docs set data=data||$1 where coll='users' and id=$2",[{name,recoveryPhone:phone},hex(req.u.email)]);
 res.json(profileOf(await getUser(req.u.email)));
});
app.post('/api/profile/recovery-email/send-code',async(req,res)=>{
 if(!req.u)return res.sendStatus(401);
 const e=norm(req.body.email);
 if(!/^\S+@\S+\.\S+$/.test(e)||e===req.u.email)return res.status(400).json({error:'Enter a different, valid recovery email address.'});
 if(!await bcrypt.compare(String(req.body.password||''),req.u.hash))return res.status(401).json({error:'Your current password is incorrect.'});
 if(!mail)return res.status(503).json({error:'Email verification is not configured. Contact the site administrator.'});
 const c=await pool.connect();
 try{
  await c.query('begin');
  await c.query('select pg_advisory_xact_lock(hashtext($1)::bigint)',[e]);
  await c.query('select pg_advisory_xact_lock(hashtext($1)::bigint)',[hex(req.u.email)]);
  if((await c.query("select 1 from docs where coll='users' and (lower(data->>'email')=$1 or lower(data->>'recoveryEmail')=$1) limit 1",[e])).rowCount){
   await c.query('rollback');return res.status(409).json({error:'That email is already in use by an account.'});
  }
  const prev=(await c.query('select sent_at from profile_email_otps where account_id=$1',[hex(req.u.email)])).rows[0];
  if(prev&&Date.now()-new Date(prev.sent_at).getTime()<60000){
   await c.query('rollback');return res.status(429).json({error:'Please wait a minute before requesting another code.'});
  }
  const code=String(crypto.randomInt(0,1000000)).padStart(6,'0');
  await mail.sendMail({from:SMTP_FROM,to:e,subject:'Your Yangu recovery email verification code',text:`Your Yangu recovery email verification code is ${code}. It expires in 10 minutes.`});
  await c.query(`insert into profile_email_otps(account_id,target_email,code_hash,expires_at,sent_at,attempts)
   values($1,$2,$3,now()+interval '10 minutes',now(),0)
   on conflict(account_id) do update set target_email=excluded.target_email,code_hash=excluded.code_hash,expires_at=excluded.expires_at,sent_at=excluded.sent_at,attempts=0`,
   [hex(req.u.email),e,otpHash(code)]);
  await c.query('commit');res.json({ok:true});
 }catch(x){await c.query('rollback');console.error(x);res.status(503).json({error:'Could not send a verification code. Check the email address or try again later.'})}
 finally{c.release()}});
app.post('/api/profile/recovery-email/verify',async(req,res)=>{
 if(!req.u)return res.sendStatus(401);
 const e=norm(req.body.email),otp=String(req.body.otp||''),accountId=hex(req.u.email);
 if(!/^\S+@\S+\.\S+$/.test(e)||e===req.u.email||!/^\d{6}$/.test(otp))return res.status(400).json({error:'Enter the recovery email and its six-digit verification code.'});
 const c=await pool.connect();
 try{
  await c.query('begin');
  await c.query('select pg_advisory_xact_lock(hashtext($1)::bigint)',[e]);
  await c.query('select pg_advisory_xact_lock(hashtext($1)::bigint)',[accountId]);
  const verification=(await c.query('select target_email,code_hash,expires_at,attempts from profile_email_otps where account_id=$1 for update',[accountId])).rows[0];
  if(!verification||verification.target_email!==e||new Date(verification.expires_at).getTime()<=Date.now()){
   await c.query('delete from profile_email_otps where account_id=$1',[accountId]);await c.query('commit');
   return res.status(400).json({error:'Your verification code expired or the email changed. Request a new code.'});
  }
  if(verification.attempts>=5){await c.query('commit');return res.status(429).json({error:'Too many incorrect codes. Request a new verification code.'})}
  const supplied=Buffer.from(otpHash(otp),'hex'),expected=Buffer.from(verification.code_hash,'hex');
  if(!crypto.timingSafeEqual(supplied,expected)){
   const attempts=verification.attempts+1;
   await c.query('update profile_email_otps set attempts=$1 where account_id=$2',[attempts,accountId]);await c.query('commit');
   return res.status(attempts>=5?429:401).json({error:attempts>=5?'Too many incorrect codes. Request a new verification code.':'That verification code is incorrect.'});
  }
  if((await c.query("select 1 from docs where coll='users' and (lower(data->>'email')=$1 or lower(data->>'recoveryEmail')=$1) limit 1",[e])).rowCount){
   await c.query('delete from profile_email_otps where account_id=$1',[accountId]);await c.query('commit');
   return res.status(409).json({error:'That email is already in use by an account.'});
  }
  await c.query("update docs set data=data||$1 where coll='users' and id=$2",[{recoveryEmail:e},accountId]);
  await c.query('delete from profile_email_otps where account_id=$1',[accountId]);
  await c.query('commit');res.json(profileOf(await getUser(req.u.email)));
 }catch(x){await c.query('rollback');console.error(x);res.status(500).json({error:'Could not update recovery email.'})}
 finally{c.release()}});
app.post('/api/profile/recovery-email/remove',async(req,res)=>{
 if(!req.u)return res.sendStatus(401);
 if(!await bcrypt.compare(String(req.body.password||''),req.u.hash))return res.status(401).json({error:'Your current password is incorrect.'});
 await q("update docs set data=data-'recoveryEmail' where coll='users' and id=$1",[hex(req.u.email)]);
 await q('delete from profile_email_otps where account_id=$1',[hex(req.u.email)]);
 res.json(profileOf(await getUser(req.u.email)));
});
app.post('/api/profile/photo',up.single('file'),async(req,res)=>{
 if(!req.u)return res.sendStatus(401);
 if(!req.file||!['image/jpeg','image/png','image/webp','image/gif'].includes(req.file.mimetype))return res.status(400).json({error:'Choose a JPEG, PNG, WebP or GIF image.'});
 const id=crypto.randomBytes(16).toString('hex');
 const c=await pool.connect();
 try{
  await c.query('begin');
  const account=(await c.query("select data from docs where coll='users' and id=$1 for update",[hex(req.u.email)])).rows[0];
  if(!account){await c.query('rollback');return res.sendStatus(401)}
  await c.query('insert into files values($1,$2,$3)',[id,req.file.mimetype,req.file.buffer]);
  await c.query("update docs set data=data||$1 where coll='users' and id=$2",[{avatarId:id},hex(req.u.email)]);
  if(account.data.avatarId)await c.query('delete from files where id=$1',[account.data.avatarId]);
  await c.query('commit');res.json({avatarId:id});
 }catch(x){await c.query('rollback');throw x}finally{c.release()}
});
app.delete('/api/profile/photo',async(req,res)=>{
 if(!req.u)return res.sendStatus(401);
 const c=await pool.connect();
 try{
  await c.query('begin');
  const account=(await c.query("select data from docs where coll='users' and id=$1 for update",[hex(req.u.email)])).rows[0];
  if(!account){await c.query('rollback');return res.sendStatus(401)}
  if(account.data.avatarId){await c.query("update docs set data=data-'avatarId' where coll='users' and id=$1",[hex(req.u.email)]);await c.query('delete from files where id=$1',[account.data.avatarId])}
  await c.query('commit');res.json({ok:true});
 }catch(x){await c.query('rollback');throw x}finally{c.release()}
});
app.post('/api/forgot',async(req,res)=>{const u=await getUser(norm(req.body.email));if(!u)return res.status(404).json({error:'No account with that email.'});res.json({q:u.q})});
app.post('/api/reset',async(req,res)=>{const e=norm(req.body.email),u=await getUser(e),pw=String(req.body.password||'');
 if(!u||pw.length<6)return res.status(400).json({error:'Password must be 6+ characters.'});
 if(!await bcrypt.compare(String(req.body.qa||'').toLowerCase().trim(),u.qah))return res.status(401).json({error:'Wrong answer.'});
 await q("update docs set data=data||$1 where coll='users' and id=$2",[{hash:await bcrypt.hash(pw,10)},hex(e)]);res.json({ok:1})});
app.post('/api/admin/reset',async(req,res)=>{if(!adm(req.u))return res.sendStatus(403);const e=norm(req.body.email),temp='Yangu'+crypto.randomInt(1000,10000);
 await q("update docs set data=data||$1 where coll='users' and id=$2",[{hash:await bcrypt.hash(temp,10)},hex(e)]);res.json({temp})});

const COLL=['products','comments','site','users','ads'],strip=({hash,qah,q,recoveryEmail,recoveryPhone,...r})=>r,publicAd=d=>({...d,hasVideo:!!d.videoId,videoId:undefined});
app.use('/api/c/:c',(req,res,next)=>COLL.includes(req.params.c)?next():res.sendStatus(404));
app.get('/api/c/:c',async(req,res)=>{const c=req.params.c;if(c==='users'&&!adm(req.u))return res.sendStatus(403);
 const rows=(await q('select id,data from docs where coll=$1',[c])).rows;
 res.json(rows.filter(r=>c!=='ads'||adm(req.u)||(r.data.approved===true&&r.data.active===true)).map(r=>({id:r.id,data:c==='users'?strip(r.data):c==='ads'&&!adm(req.u)?publicAd(r.data):r.data})))});
app.get('/api/c/:c/:id',async(req,res)=>{const{c,id}=req.params;if(c==='users')return res.sendStatus(403);
 const r=(await q('select data from docs where coll=$1 and id=$2',[c,id])).rows[0];
 if(!r||(c==='ads'&&!adm(req.u)&&(r.data.approved!==true||r.data.active!==true)))return res.sendStatus(404);
 res.json({data:c==='ads'&&!adm(req.u)?publicAd(r.data):r.data})});
const write=merge=>async(req,res)=>{const{c,id}=req.params,u=req.u;
 if(!u)return res.sendStatus(401);if(c==='users'||((c==='site'||c==='ads')&&!adm(u)))return res.sendStatus(403);
 const old=(await q('select data from docs where coll=$1 and id=$2',[c,id])).rows[0]?.data;let d=req.body||{};
 if(c==='products'){if(old&&old.email!==u.email&&!adm(u))return res.sendStatus(403);
  d=old?{...d,email:old.email,sname:old.sname,phone:old.phone}:{...d,email:u.email,sname:u.name,phone:u.phone}}
 if(c==='ads'){
  if(typeof d.title!=='string'||(d.description!==undefined&&typeof d.description!=='string')||(d.linkUrl!==undefined&&typeof d.linkUrl!=='string')||(d.videoUrl!==undefined&&typeof d.videoUrl!=='string')||(d.videoId!==undefined&&typeof d.videoId!=='string'))return res.status(400).json({error:'Ad title, description, links, and video details must be text.'});
  const title=String(d.title||'').trim(),description=String(d.description||'').trim(),linkUrl=String(d.linkUrl||'').trim(),videoUrl=String(d.videoUrl||'').trim(),videoId=String(d.videoId||'').trim();
  if(!title||title.length>100||description.length>300)return res.status(400).json({error:'Enter an ad title (up to 100 characters) and description (up to 300 characters).'});
  for(const candidate of [linkUrl,videoUrl])if(candidate){let url;try{url=new URL(candidate)}catch{return res.status(400).json({error:'Ad links and video URLs must be valid HTTPS URLs.'})}
   if(url.protocol!=='https:'||url.username||url.password)return res.status(400).json({error:'Ad links and video URLs must be valid HTTPS URLs.'})}
  if(videoUrl&&videoId)return res.status(400).json({error:'Choose a hosted video URL or an uploaded video, not both.'});
  if(videoId){
   if(!/^[a-f\d]{32}$/i.test(videoId))return res.status(400).json({error:'The uploaded video is invalid.'});
   const file=(await q('select mime from files where id=$1',[videoId])).rows[0];
   if(!file||!['video/mp4','video/webm'].includes(file.mime))return res.status(400).json({error:'The uploaded video could not be found.'});
  }
  d={title,description,linkUrl,videoUrl,videoId,active:d.active===true,approved:true,approvedBy:u.email,approvedAt:new Date().toISOString()};
 }
 if(c==='comments'){if(old)return res.sendStatus(403);d={...d,email:u.email,name:u.name}}
 await q('insert into docs values($1,$2,$3) on conflict(coll,id) do update set data='+(merge?'docs.data||$3':'$3'),[c,id,d]);res.json({ok:1})};
app.put('/api/c/:c/:id',write(false));app.patch('/api/c/:c/:id',write(true));
app.delete('/api/c/:c/:id',async(req,res)=>{if(!adm(req.u))return res.sendStatus(403);
 if(req.params.c==='users'&&(await q("select 1 from admin_slots where user_id=$1",[req.params.id])).rowCount)return res.status(409).json({error:'Administrator accounts cannot be deleted.'});
 await q('delete from docs where coll=$1 and id=$2',[req.params.c,req.params.id]);res.json({ok:1})});

app.get('/api/ads/:id/video',async(req,res)=>{const ad=(await q("select data from docs where coll='ads' and id=$1",[req.params.id])).rows[0]?.data;
 if(!ad||(!adm(req.u)&&(!ad.approved||!ad.active))||!ad.videoId)return res.sendStatus(404);
 const file=(await q('select mime,data from files where id=$1',[ad.videoId])).rows[0];
 if(!file||!['video/mp4','video/webm'].includes(file.mime))return res.sendStatus(404);
 res.type(file.mime).set('Cache-Control','private,no-store').send(file.data)});
app.post('/api/upload-video',async(req,res,next)=>{if(!adm(req.u))return res.sendStatus(403);
 try{await new Promise((resolve,reject)=>videoUp.single('file')(req,res,err=>err?reject(err):resolve()))}
 catch(err){if(err.code==='LIMIT_FILE_SIZE')return res.status(413).json({error:'Videos must be 20 MB or smaller.'});return next(err)}
 const file=req.file;if(!file)return res.status(400).json({error:'Choose an MP4 or WebM video.'});
 const isMp4=file.mimetype==='video/mp4'&&file.buffer.subarray(4,8).toString()==='ftyp';
 const isWebm=file.mimetype==='video/webm'&&file.buffer.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]));
 if(!isMp4&&!isWebm)return res.status(415).json({error:'Only valid MP4 or WebM videos are supported.'});
 const id=crypto.randomBytes(16).toString('hex');await q('insert into files values($1,$2,$3)',[id,file.mimetype,file.buffer]);res.json({id});
});
app.post('/api/upload',up.single('file'),async(req,res)=>{if(!req.u||!req.file||!/^image\//.test(req.file.mimetype))return res.sendStatus(400);
 const id=crypto.randomBytes(16).toString('hex');await q('insert into files values($1,$2,$3)',[id,req.file.mimetype,req.file.buffer]);res.json({id})});
app.get('/_blob/:id',async(req,res)=>{const r=(await q('select mime,data from files where id=$1',[req.params.id.replace(/\W/g,'')])).rows[0];
 if(!r||r.mime.startsWith('video/'))return res.sendStatus(404);res.type(r.mime).set('Cache-Control','public,max-age=31536000,immutable').send(r.data)});
app.use(express.static(path.join(__dirname,'public')));
async function initializeAdmins(){
 const c=await pool.connect();
 try{
  await c.query('begin');
  await c.query("select pg_advisory_xact_lock(hashtext('yangu-admin-accounts')::bigint)");
  const slots=(await c.query('select slot from admin_slots')).rows;
  if(!slots.length){
   const users=(await c.query("select id from docs where coll='users' order by case when data->>'created' ~ '^[0-9]+$' then (data->>'created')::numeric else 0 end,id limit 2")).rows;
   for(let i=0;i<users.length;i++)await c.query('insert into admin_slots(slot,user_id) values($1,$2)',[i+1,users[i].id]);
  }
  await c.query(`update docs u set data=jsonb_set(u.data,'{role}',to_jsonb(case when exists(select 1 from admin_slots s where s.user_id=u.id) then 'admin' else 'seller' end),true)
   where u.coll='users' and u.data->>'role' is distinct from case when exists(select 1 from admin_slots s where s.user_id=u.id) then 'admin' else 'seller' end`);
  await c.query('commit');
 }catch(err){await c.query('rollback');throw err}finally{c.release()}
}
q('create table if not exists docs(coll text,id text,data jsonb not null,primary key(coll,id));create table if not exists files(id text primary key,mime text,data bytea);create table if not exists signup_otps(email text primary key,code_hash text not null,expires_at timestamptz not null,sent_at timestamptz not null,attempts integer not null default 0)')
 .then(()=>q('alter table signup_otps add column if not exists link_token_hash text, add column if not exists verified_at timestamptz'))
 .then(()=>q('create table if not exists profile_email_otps(account_id text primary key,target_email text not null,code_hash text not null,expires_at timestamptz not null,sent_at timestamptz not null,attempts integer not null default 0)'))
 .then(()=>q('create table if not exists admin_slots(slot smallint primary key check(slot in (1,2)),user_id text not null unique)'))
 .then(initializeAdmins)
 .then(()=>app.listen(process.env.PORT||3000,()=>console.log('Yangu Market Stores running')));
