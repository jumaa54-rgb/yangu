const express=require('express'),{Pool}=require('pg'),bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken'),cp=require('cookie-parser'),multer=require('multer'),path=require('path'),crypto=require('crypto'),nodemailer=require('nodemailer');
const SECRET=process.env.JWT_SECRET;if(!SECRET)throw new Error('Set JWT_SECRET');
const norm=e=>String(e||'').trim().toLowerCase();
const ADMIN_EMAILS=new Set((process.env.ADMIN_EMAILS||'').split(',').map(norm).filter(Boolean));
const prod=process.env.NODE_ENV==='production';
const SMTP_HOST=process.env.SMTP_HOST,SMTP_PORT=Number(process.env.SMTP_PORT||587),SMTP_USER=process.env.SMTP_USER,SMTP_PASS=process.env.SMTP_PASS,SMTP_FROM=process.env.SMTP_FROM||SMTP_USER;
const mail=SMTP_HOST&&SMTP_USER&&SMTP_PASS&&SMTP_FROM?nodemailer.createTransport({host:SMTP_HOST,port:SMTP_PORT,secure:SMTP_PORT===465,auth:{user:SMTP_USER,pass:SMTP_PASS}}):null;
const PUBLIC_URL=process.env.PUBLIC_URL||process.env.RENDER_EXTERNAL_URL||'http://localhost:3000';
const TERMS_VERSION='2026-10-30';
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:prod?{rejectUnauthorized:false}:false});
const q=(s,p)=>pool.query(s,p),hex=e=>Buffer.from(e).toString('hex');
const app=express();app.set('trust proxy',1);app.use(express.json({limit:'1mb'}),cp());
const up=multer({storage:multer.memoryStorage(),limits:{fileSize:3e6}});
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
 if(!name||!/^\S+@\S+\.\S+$/.test(e)||String(phone||'').replace(/\D/g,'').length<9||String(password||'').length<6||!qa)return res.status(400).json({error:'Fill all fields correctly (valid email, phone, 6+ character password).'});
 if(termsAccepted!==true||termsVersion!==TERMS_VERSION)return res.status(400).json({error:'Read and accept the current Terms and Conditions before creating an account.'});
 const c=await pool.connect();
 try{
  await c.query('begin');
  await c.query('select pg_advisory_xact_lock(hashtext($1)::bigint)',[e]);
  if((await c.query("select 1 from docs where coll='users' and (id=$1 or lower(data->>'recoveryEmail')=$2) limit 1",[hex(e),e])).rowCount){
   await c.query('commit');
   return res.status(409).json({error:'This email is already in use by an account.'});
  }
  const ins=await c.query("insert into docs values('users',$1,$2) on conflict do nothing returning 1",[hex(e),{email:e,emailVerified:false,termsAcceptedAt:new Date().toISOString(),termsVersion:TERMS_VERSION,name:String(name).slice(0,80),phone:String(phone).slice(0,30),hash:await bcrypt.hash(String(password),10),q:qn,qah:await bcrypt.hash(String(qa).toLowerCase().trim(),10),role:ADMIN_EMAILS.has(e)?'admin':'seller',created:Date.now()}]);
  if(!ins.rowCount){await c.query('commit');return res.status(409).json({error:'This email already has an account. Please log in.'})}
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

const COLL=['products','comments','site','users'],strip=({hash,qah,q,recoveryEmail,recoveryPhone,...r})=>r;
app.use('/api/c/:c',(req,res,next)=>COLL.includes(req.params.c)?next():res.sendStatus(404));
app.get('/api/c/:c',async(req,res)=>{const c=req.params.c;if(c==='users'&&!adm(req.u))return res.sendStatus(403);
 res.json((await q('select id,data from docs where coll=$1',[c])).rows.map(r=>({id:r.id,data:c==='users'?strip(r.data):r.data})))});
app.get('/api/c/:c/:id',async(req,res)=>{const{c,id}=req.params;if(c==='users')return res.sendStatus(403);
 const r=(await q('select data from docs where coll=$1 and id=$2',[c,id])).rows[0];r?res.json({data:r.data}):res.sendStatus(404)});
const write=merge=>async(req,res)=>{const{c,id}=req.params,u=req.u;
 if(!u)return res.sendStatus(401);if(c==='users'||(c==='site'&&!adm(u)))return res.sendStatus(403);
 const old=(await q('select data from docs where coll=$1 and id=$2',[c,id])).rows[0]?.data;let d=req.body||{};
 if(c==='products'){if(old&&old.email!==u.email&&!adm(u))return res.sendStatus(403);
  d=old?{...d,email:old.email,sname:old.sname,phone:old.phone}:{...d,email:u.email,sname:u.name,phone:u.phone}}
 if(c==='comments'){if(old)return res.sendStatus(403);d={...d,email:u.email,name:u.name}}
 await q('insert into docs values($1,$2,$3) on conflict(coll,id) do update set data='+(merge?'docs.data||$3':'$3'),[c,id,d]);res.json({ok:1})};
app.put('/api/c/:c/:id',write(false));app.patch('/api/c/:c/:id',write(true));
app.delete('/api/c/:c/:id',async(req,res)=>{if(!adm(req.u))return res.sendStatus(403);await q('delete from docs where coll=$1 and id=$2',[req.params.c,req.params.id]);res.json({ok:1})});

app.post('/api/upload',up.single('file'),async(req,res)=>{if(!req.u||!req.file||!/^image\//.test(req.file.mimetype))return res.sendStatus(400);
 const id=crypto.randomBytes(16).toString('hex');await q('insert into files values($1,$2,$3)',[id,req.file.mimetype,req.file.buffer]);res.json({id})});
app.get('/_blob/:id',async(req,res)=>{const r=(await q('select mime,data from files where id=$1',[req.params.id.replace(/\W/g,'')])).rows[0];
 if(!r)return res.sendStatus(404);res.type(r.mime).set('Cache-Control','public,max-age=31536000,immutable').send(r.data)});
app.use(express.static(path.join(__dirname,'public')));
q('create table if not exists docs(coll text,id text,data jsonb not null,primary key(coll,id));create table if not exists files(id text primary key,mime text,data bytea);create table if not exists signup_otps(email text primary key,code_hash text not null,expires_at timestamptz not null,sent_at timestamptz not null,attempts integer not null default 0)')
 .then(()=>q('alter table signup_otps add column if not exists link_token_hash text, add column if not exists verified_at timestamptz'))
 .then(()=>q('create table if not exists profile_email_otps(account_id text primary key,target_email text not null,code_hash text not null,expires_at timestamptz not null,sent_at timestamptz not null,attempts integer not null default 0)'))
 .then(()=>app.listen(process.env.PORT||3000,()=>console.log('Yangu Market Stores running')));
