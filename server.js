const express=require('express'),{Pool}=require('pg'),bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken'),cp=require('cookie-parser'),multer=require('multer'),path=require('path'),crypto=require('crypto'),nodemailer=require('nodemailer'),https=require('https'),dns=require('dns').promises,net=require('net');
const SECRET=process.env.JWT_SECRET;if(!SECRET)throw new Error('Set JWT_SECRET');
const norm=e=>String(e||'').trim().toLowerCase();
const htmlEscape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const ANTHROPIC_API_KEY=process.env.ANTHROPIC_API_KEY,ANTHROPIC_MODEL=process.env.ANTHROPIC_MODEL||'claude-haiku-5-5';
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
const TERMS_VERSION='2026-11-04';
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:prod?{rejectUnauthorized:false}:false});
const q=(s,p)=>pool.query(s,p),hex=e=>Buffer.from(e).toString('hex');
const app=express();app.set('trust proxy',1);app.use(express.json({limit:'1mb'}),cp());
const up=multer({storage:multer.memoryStorage(),limits:{fileSize:3e6}});
const videoUp=multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024}});
const sign=(res,e,u,mfa=false)=>res.cookie('t',jwt.sign({e,v:u?.authVersion||0,...(adm(u)?{mfa}: {})},SECRET,{expiresIn:'30d'}),{httpOnly:true,sameSite:'lax',secure:prod,maxAge:2592e6});
const pub=u=>({email:u.email,name:u.name,phone:u.phone,role:u.role,avatarId:u.avatarId||''}),adm=u=>u&&u.role==='admin';
const imageSignatures={
 'image/jpeg':buffer=>buffer.length>=3&&buffer[0]===0xff&&buffer[1]===0xd8&&buffer[2]===0xff,
 'image/png':buffer=>buffer.length>=8&&buffer.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])),
 'image/webp':buffer=>buffer.length>=12&&buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP',
 'image/gif':buffer=>buffer.length>=6&&['GIF87a','GIF89a'].includes(buffer.toString('ascii',0,6))
};
const safeImage=file=>file&&imageSignatures[file.mimetype]?.(file.buffer)===true;
const isPublicIPv4=address=>{
 const [a,b,c]=address.split('.').map(Number);
 return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||
  (a===192&&(b===0||b===168||b===88&&c===99))||(a===198&&(b===18||b===19||b===51&&c===100))||(a===203&&b===0&&c===113));
};
const safeVideoLookup=(hostname,options,callback)=>{
 dns.lookup(hostname,{all:true,verbatim:true}).then(addresses=>{
  const resolved=addresses.find(item=>net.isIP(item.address)===4&&isPublicIPv4(item.address));
  if(!resolved)return callback(new Error('The video host must resolve to a public IPv4 address.'));
  callback(null,options?.all?[resolved]:resolved.address,options?.all?undefined:4);
 }).catch(callback)
};
const fetchLinkedVideo=async(value,redirects=0)=>{
 let url;try{url=new URL(value)}catch{throw new Error('Enter a valid direct video URL.')}
 if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||net.isIP(url.hostname))throw new Error('Video links must use a public HTTPS host on the standard port.');
 if(redirects>4)throw new Error('The video link redirected too many times.');
 const result=await new Promise((resolve,reject)=>{
  const request=https.get(url,{lookup:safeVideoLookup,headers:{'user-agent':'Yangu-Market-Video-Importer/1.0'},timeout:20000},response=>{
   if([301,302,303,307,308].includes(response.statusCode)){
    const location=response.headers.location;response.resume();
    if(!location)return reject(new Error('The video host returned an invalid redirect.'));
    let redirected;try{redirected=new URL(location,url).toString()}catch{return reject(new Error('The video host returned an invalid redirect.'))}
    return resolve({redirected})
   }
   if(response.statusCode!==200){response.resume();return reject(new Error('The video host did not return a playable video.'))}
   const type=String(response.headers['content-type']||'').split(';')[0].trim().toLowerCase();
   if(type&&!['video/mp4','video/webm','application/octet-stream','binary/octet-stream'].includes(type)){response.resume();return reject(new Error('The link must point directly to an MP4 or WebM video file.'))}
   const length=Number(response.headers['content-length']||0);
   if(length>20*1024*1024){response.resume();return reject(new Error('Linked videos must be 20 MB or smaller.'))}
   const chunks=[];let size=0;
   response.on('data',chunk=>{
    size+=chunk.length;
    if(size>20*1024*1024){request.destroy(new Error('Linked videos must be 20 MB or smaller.'));return}
    chunks.push(chunk)
   });
   response.on('end',()=>resolve({data:Buffer.concat(chunks),type}));
   response.on('error',reject)
  });
  request.setTimeout(20000,()=>request.destroy(new Error('The video host took too long to respond.')));
  request.on('error',reject)
 });
 if(result.redirected)return fetchLinkedVideo(result.redirected,redirects+1);
 const mime=result.data.subarray(4,8).toString()==='ftyp'?'video/mp4':
  result.data.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))?'video/webm':'';
 if(!mime||result.type&&result.type!=='application/octet-stream'&&result.type!=='binary/octet-stream'&&result.type!==mime)
  throw new Error('The link did not contain a valid MP4 or WebM video file.');
 return{mime,data:result.data}
};
const getUser=async e=>(await q("select data from docs where coll='users' and id=$1",[hex(e)])).rows[0]?.data;
const otpHash=code=>crypto.createHmac('sha256',SECRET).update(code).digest('hex');
const encodeBase32=buffer=>{
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits=0,value=0,out='';
 for(const byte of buffer){value=(value<<8)|byte;bits+=8;while(bits>=5){out+=alphabet[(value>>>(bits-5))&31];bits-=5}}
 if(bits)out+=alphabet[(value<<(5-bits))&31];
 return out
};
const decodeBase32=text=>{
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits=0,value=0,out=[];
 for(const char of String(text||'').toUpperCase().replace(/=+$/,'')){const digit=alphabet.indexOf(char);if(digit<0)return Buffer.alloc(0);value=(value<<5)|digit;bits+=5;if(bits>=8){out.push((value>>>(bits-8))&255);bits-=8}}
 return Buffer.from(out)
};
const totpCounter=(secret,code,now=Date.now())=>{
 if(!/^\d{6}$/.test(String(code||'')))return null;
 const key=decodeBase32(secret);if(!key.length)return null;
 const current=Math.floor(now/30000);
 for(const counter of [current-1,current,current+1]){
  const message=Buffer.alloc(8);message.writeBigUInt64BE(BigInt(counter));
  const digest=crypto.createHmac('sha1',key).update(message).digest(),offset=digest[digest.length-1]&15;
  const binary=((digest[offset]&127)<<24)|(digest[offset+1]<<16)|(digest[offset+2]<<8)|digest[offset+3];
  const expected=Buffer.from(String(binary%1e6).padStart(6,'0'));
  if(crypto.timingSafeEqual(expected,Buffer.from(String(code))))return counter;
 }
 return null
};
const updatePassword=async(e,hash)=>{
 const connection=await pool.connect();
 try{
  await connection.query('begin');
  await connection.query('delete from admin_login_challenges where user_id=$1',[hex(e)]);
  const result=await connection.query(`update docs set data=jsonb_set(
   jsonb_set(data,'{hash}',to_jsonb($1::text),true),
   '{authVersion}',to_jsonb(coalesce(nullif(data->>'authVersion','')::int,0)+1),true)
   where coll='users' and id=$2`,[hash,hex(e)]);
  await connection.query('commit');return result
 }catch(error){await connection.query('rollback');throw error}finally{connection.release()}
};
app.use((req,res,next)=>{
 res.set('X-Content-Type-Options','nosniff').set('X-Frame-Options','DENY').set('Referrer-Policy','strict-origin-when-cross-origin')
  .set('Permissions-Policy','geolocation=(self)');
 if(prod)res.set('Strict-Transport-Security','max-age=31536000; includeSubDomains');
 next();
});
app.use(async(req,res,next)=>{try{
 const token=jwt.verify(req.cookies.t,SECRET),user=await getUser(token.e);
 req.u=user&&Number(token.v||0)===Number(user.authVersion||0)&&(!adm(user)||(token.mfa===true&&user.totpEnabled===true))?user:null;
}catch{req.u=null}next()});

app.post('/api/signup',async(req,res)=>{
 const{name,email,phone,password,q:qn,qa,termsAccepted,termsVersion}=req.body,e=norm(email);
 if(!validEmail(e))return res.status(400).json({error:'Enter a valid email address (for example, name@example.com).'});
 if(!name||String(phone||'').replace(/\D/g,'').length<9||String(password||'').length<6||!qa)return res.status(400).json({error:'Fill all fields correctly (valid phone, 6+ character password, and recovery answer).'});
 if(termsAccepted!==true||termsVersion!==TERMS_VERSION)return res.status(400).json({error:'Read and accept the current Terms and Conditions before creating an account.'});
 const c=await pool.connect();
 try{
  await c.query('begin');
  await c.query('select pg_advisory_xact_lock(hashtext($1)::bigint)',[e]);
  if((await c.query("select 1 from docs where coll='users' and (id=$1 or lower(data->>'recoveryEmail')=$2) limit 1",[hex(e),e])).rowCount){
   await c.query('commit');
   return res.status(409).json({error:'This email is already in use by an account.'});
  }
  const ins=await c.query("insert into docs values('users',$1,$2) on conflict do nothing returning 1",[hex(e),{email:e,emailVerified:false,termsAcceptedAt:new Date().toISOString(),termsVersion:TERMS_VERSION,name:String(name).slice(0,80),phone:String(phone).slice(0,30),hash:await bcrypt.hash(String(password),10),q:qn,qah:await bcrypt.hash(String(qa).toLowerCase().trim(),10),role:'seller',created:Date.now()}]);
  if(!ins.rowCount){await c.query('commit');return res.status(409).json({error:'This email already has an account. Please log in.'})}
  await c.query('commit');
  const user=await getUser(e);sign(res,e,user);
  let welcomeEmailSent=false;
  if(mail){
   const siteUrl=process.env.PUBLIC_URL||'https://yangu-market-stores.onrender.com',name=String(user.name||'there'),safeName=htmlEscape(name);
   try{
    await mail.sendMail({
     from:SMTP_FROM,to:e,subject:'Welcome to Yangu Market Stores',
     text:`Hello ${name},\n\nWelcome to Yangu Market Stores, and thank you for joining us!\n\nYou can now explore goods from local sellers, connect directly with buyers and sellers, or list products of your own.\n\nVisit us at ${siteUrl}\n\nThank you for being part of Yangu Market Stores.`,
     html:`<div style="font-family:Arial,sans-serif;line-height:1.6;color:#20242a;max-width:600px;margin:auto"><h1 style="color:#176b4d">Welcome to Yangu Market Stores!</h1><p>Hello ${safeName},</p><p>Thank you for joining us. We are glad to have you in our community.</p><p>Explore goods from local sellers, connect directly with buyers and sellers, or list products of your own.</p><p><a href="${htmlEscape(siteUrl)}" style="display:inline-block;background:#176b4d;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none">Visit Yangu Market Stores</a></p><p>Thank you for being part of Yangu Market Stores.</p></div>`
    });
    welcomeEmailSent=true;
   }catch(error){console.error('Welcome email could not be sent:',error.name||'Error')}
  }
  res.json({...pub(user),welcomeEmailSent});
 }catch(x){await c.query('rollback');console.error(x);res.status(500).json({error:'Server error'})}finally{c.release()}});
const adminMfaCookie={httpOnly:true,sameSite:'strict',secure:prod,maxAge:5*60*1000,path:'/api/admin/mfa'};
const clearAdminMfaCookie=res=>res.clearCookie('admin_mfa_challenge',{path:adminMfaCookie.path});
app.post('/api/login',async(req,res)=>{clearAdminMfaCookie(res);const e=norm(req.body.email),u=await getUser(e);
 if(!u)return res.status(404).json({error:'No account with that email.'});
 if(!await bcrypt.compare(String(req.body.password||''),u.hash))return res.status(401).json({error:'Wrong password.'});
 if(adm(u)){
  const token=crypto.randomBytes(32).toString('base64url');
  await q('delete from admin_login_challenges where expires_at<=now() or user_id=$1',[hex(e)]);
  await q('insert into admin_login_challenges(token_hash,user_id,expires_at) values($1,$2,$3)',[otpHash(token),hex(e),new Date(Date.now()+5*60*1000)]);
  res.clearCookie('t');res.cookie('admin_mfa_challenge',token,adminMfaCookie);
  return res.json({mfaRequired:true,setupRequired:u.totpEnabled!==true});
 }
 sign(res,e,u);res.json(pub(u))});
const getAdminMfaChallenge=async req=>{
 const token=req.cookies.admin_mfa_challenge;
 if(!token)return null;
 return(await q('select token_hash,user_id,attempts from admin_login_challenges where token_hash=$1 and expires_at>now() and attempts<5',[otpHash(token)])).rows[0]||null
};
app.post('/api/admin/mfa/setup',async(req,res)=>{
 const challenge=await getAdminMfaChallenge(req);
 if(!challenge){clearAdminMfaCookie(res);return res.status(401).json({error:'Your administrator sign-in has expired. Enter your password again.'})}
 const email=Buffer.from(challenge.user_id,'hex').toString(),user=await getUser(email);
 if(!adm(user)){clearAdminMfaCookie(res);return res.sendStatus(403)}
 if(user.totpEnabled===true)return res.status(409).json({error:'An authenticator is already set up. Enter its current code.'});
 const secret=user.totpPendingSecret||encodeBase32(crypto.randomBytes(20));
 if(!user.totpPendingSecret)await q("update docs set data=jsonb_set(data,'{totpPendingSecret}',to_jsonb($1::text),true) where coll='users' and id=$2",[secret,challenge.user_id]);
 const label=encodeURIComponent(`Yangu Market Stores:${email}`),issuer=encodeURIComponent('Yangu Market Stores');
 res.json({secret,otpauthUrl:`otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`});
});
app.post('/api/admin/mfa/verify',async(req,res)=>{
 const connection=await pool.connect();
 try{
  await connection.query('begin');
  const challenge=(await connection.query('select token_hash,user_id,attempts from admin_login_challenges where token_hash=$1 and expires_at>now() and attempts<5 for update',[otpHash(req.cookies.admin_mfa_challenge||'')])).rows[0];
  if(!challenge){await connection.query('rollback');clearAdminMfaCookie(res);return res.status(401).json({error:'Your administrator sign-in has expired. Enter your password again.'})}
  const row=(await connection.query("select data from docs where coll='users' and id=$1 for update",[challenge.user_id])).rows[0],user=row?.data;
  if(!adm(user)){await connection.query('delete from admin_login_challenges where token_hash=$1',[challenge.token_hash]);await connection.query('commit');clearAdminMfaCookie(res);return res.sendStatus(403)}
  const isEnabled=user.totpEnabled===true,secret=isEnabled?user.totpSecret:user.totpPendingSecret,counter=totpCounter(secret,req.body?.code);
  if(counter===null||counter<=Number(user.totpLastCounter??-1)){
   const attempts=Number(challenge.attempts)+1;
   if(attempts>=5)await connection.query('delete from admin_login_challenges where token_hash=$1',[challenge.token_hash]);
   else await connection.query('update admin_login_challenges set attempts=$1 where token_hash=$2',[attempts,challenge.token_hash]);
   await connection.query('commit');if(attempts>=5)clearAdminMfaCookie(res);
   return res.status(attempts>=5?429:401).json({error:attempts>=5?'Too many incorrect codes. Enter your password again.':'Enter the current six-digit code from your authenticator app.'})
  }
  const update=isEnabled
   ?await connection.query("update docs set data=jsonb_set(data,'{totpLastCounter}',to_jsonb($1::bigint),true) where coll='users' and id=$2 returning data",[counter,challenge.user_id])
   :await connection.query(`update docs set data=(data-'totpPendingSecret')||jsonb_build_object(
     'totpSecret',$1::text,'totpEnabled',true,'totpLastCounter',$2::bigint,
     'authVersion',coalesce(nullif(data->>'authVersion','')::int,0)+1)
     where coll='users' and id=$3 returning data`,[secret,counter,challenge.user_id]);
  await connection.query('delete from admin_login_challenges where token_hash=$1',[challenge.token_hash]);
  await connection.query('commit');clearAdminMfaCookie(res);
  const authenticated=update.rows[0].data;sign(res,authenticated.email,authenticated,true);res.json(pub(authenticated));
 }catch(error){await connection.query('rollback');throw error}finally{connection.release()}
});
app.post('/api/admin/mfa/reset',async(req,res)=>{
 if(!adm(req.u))return res.sendStatus(403);
 const email=norm(req.body.email);
 if(email===req.u.email)return res.status(400).json({error:'Ask another administrator to reset your authenticator.'});
 const connection=await pool.connect();
 try{
  await connection.query('begin');
  await connection.query('delete from admin_login_challenges where user_id=$1',[hex(email)]);
  const result=await connection.query(`update docs set data=(data-'totpSecret'-'totpPendingSecret'-'totpLastCounter')||jsonb_build_object(
   'totpEnabled',false,'authVersion',coalesce(nullif(data->>'authVersion','')::int,0)+1)
   where coll='users' and id=$1 and data->>'role'='admin' returning 1`,[hex(email)]);
  await connection.query('commit');
  if(!result.rowCount)return res.status(404).json({error:'No administrator account with that email.'});
  res.json({ok:true});
 }catch(error){await connection.query('rollback');throw error}finally{connection.release()}
});
app.post('/api/logout',async(req,res)=>{
 res.clearCookie('t');
 if(req.cookies.admin_mfa_challenge)await q('delete from admin_login_challenges where token_hash=$1',[otpHash(req.cookies.admin_mfa_challenge)]);
 clearAdminMfaCookie(res);res.json({ok:1})
});
app.get('/api/me',(req,res)=>res.json(req.u?pub(req.u):null));
app.post('/api/ai-assist',async(req,res)=>{
 const{mode}=req.body||{},message=typeof req.body?.message==='string'?req.body.message.trim():'';
 if(!['buyer','seller'].includes(mode)||!message||message.length>1000)return res.status(400).json({error:'Choose buyer or seller help and enter a message of up to 1,000 characters.'});
 if(mode==='seller'&&!req.u)return res.status(401).json({error:'Log in to use seller assistance.'});
 if(!ANTHROPIC_API_KEY)return res.status(503).json({error:'AI assistance is not configured yet. Please try again later.'});
 const catalog=(await q(`select id,data from docs where coll='products'
  order by case when $1::text is not null and data->>'email'=$1 then 0 else 1 end,
  case when data->>'created' ~ '^[0-9]{1,15}$' then (data->>'created')::bigint else 0 end desc,id limit 60`,[mode==='seller'?req.u.email:null])).rows
  .filter(row=>typeof row.data.title==='string'&&row.data.title.trim())
  .map(row=>({id:row.id,title:String(row.data.title).slice(0,120),price:Number.isFinite(Number(row.data.price))?Number(row.data.price):null,
   category:String(row.data.cat||''),subcategory:String(row.data.sub||''),description:String(row.data.desc||'').slice(0,160)}));
 const system=mode==='buyer'
  ?'You are Yangu Market Stores’ helpful buyer assistant for a Kenyan marketplace. Use KSh for prices. Recommend only from the provided live listing catalogue, never invent listings, stock, seller details, or specifications. Offer practical buying advice and remind the user to confirm availability and details with the seller. Return valid JSON only with this shape: {"reply":"short helpful answer","productIds":["matching listing ids, best first, maximum 5"]}. Use an empty productIds array when no listing fits.'
  :'You are Yangu Market Stores’ practical coach for local marketplace sellers in Kenya. Help with listing quality, honest product descriptions, pricing considerations, customer communication, and how to use the marketplace. Use only facts supplied by the seller or the catalogue; never invent product features or claim a sale is guaranteed. Return valid JSON only with this shape: {"reply":"helpful answer","productIds":["relevant example listing ids, maximum 5"]}. Use an empty productIds array when no examples help.';
 try{
  const response=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'x-api-key':ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','content-type':'application/json'},
   body:JSON.stringify({model:ANTHROPIC_MODEL,max_tokens:700,system,messages:[{role:'user',content:`Marketplace listings (JSON): ${JSON.stringify(catalog)}\n\n${mode==='seller'?'The seller’s own listings appear first when available. ':''}Question: ${message}`} ]})});
  if(!response.ok){console.error('AI provider request failed with status',response.status);return res.status(502).json({error:'AI assistance could not respond right now. Please try again.'})}
  const result=await response.json(),text=result.content?.filter(item=>item.type==='text').map(item=>item.text).join('').trim();
  let answer;try{answer=JSON.parse(text)}catch{return res.status(502).json({error:'AI assistance returned an unreadable response. Please try again.'})}
  if(typeof answer.reply!=='string')return res.status(502).json({error:'AI assistance returned an incomplete response. Please try again.'});
  const ids=new Set(catalog.map(item=>item.id)),productIds=Array.isArray(answer.productIds)?answer.productIds.filter(id=>typeof id==='string'&&ids.has(id)).slice(0,5):[];
  res.json({reply:answer.reply.slice(0,2000),productIds});
 }catch(err){console.error('AI provider request failed:',err.name||'Error');res.status(502).json({error:'AI assistance could not connect right now. Please try again.'})}
});
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
 if(!safeImage(req.file))return res.status(415).json({error:'Choose a valid JPEG, PNG, WebP or GIF image.'});
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
 if(adm(u))return res.status(403).json({error:'Administrator passwords must be reset by another administrator.'});
 if(!await bcrypt.compare(String(req.body.qa||'').toLowerCase().trim(),u.qah))return res.status(401).json({error:'Wrong answer.'});
 await updatePassword(e,await bcrypt.hash(pw,10));res.json({ok:1})});
app.post('/api/admin/reset',async(req,res)=>{
 if(!adm(req.u))return res.sendStatus(403);
 const e=norm(req.body.email),temp=crypto.randomBytes(24).toString('base64url'),hash=await bcrypt.hash(temp,10);
 const result=await updatePassword(e,hash);
 if(!result.rowCount)return res.status(404).json({error:'No account with that email.'});
 res.json({temp})
});

const COLL=['products','comments','site','users','ads'],strip=({hash,qah,q,recoveryEmail,recoveryPhone,totpSecret,totpPendingSecret,totpLastCounter,...r})=>r,publicAd=d=>({...d,hasVideo:!!d.videoId,videoId:undefined});
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
 res.type(file.mime).set('Accept-Ranges','bytes').set('Cache-Control','private,no-store');
 const range=req.range(file.data.length);
 if(range===-1||range===-2)return res.status(416).set('Content-Range',`bytes */${file.data.length}`).end();
 if(Array.isArray(range)){
  const{start,end}=range[0];
  return res.status(206).set('Content-Range',`bytes ${start}-${end}/${file.data.length}`).set('Content-Length',String(end-start+1)).send(file.data.subarray(start,end+1))
 }
 res.set('Content-Length',String(file.data.length)).send(file.data)});
app.post('/api/upload-video',async(req,res,next)=>{if(!adm(req.u))return res.sendStatus(403);
 try{await new Promise((resolve,reject)=>videoUp.single('file')(req,res,err=>err?reject(err):resolve()))}
 catch(err){if(err.code==='LIMIT_FILE_SIZE')return res.status(413).json({error:'Videos must be 20 MB or smaller.'});return next(err)}
 const file=req.file;if(!file)return res.status(400).json({error:'Choose an MP4 or WebM video.'});
 const isMp4=file.mimetype==='video/mp4'&&file.buffer.subarray(4,8).toString()==='ftyp';
 const isWebm=file.mimetype==='video/webm'&&file.buffer.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]));
 if(!isMp4&&!isWebm)return res.status(415).json({error:'Only valid MP4 or WebM videos are supported.'});
 const id=crypto.randomBytes(16).toString('hex');await q('insert into files values($1,$2,$3)',[id,file.mimetype,file.buffer]);res.json({id});
});
app.post('/api/import-video',async(req,res)=>{
 if(!adm(req.u))return res.sendStatus(403);
 try{
  const {mime,data}=await fetchLinkedVideo(String(req.body?.url||''));
  const id=crypto.randomBytes(16).toString('hex');await q('insert into files values($1,$2,$3)',[id,mime,data]);res.json({id});
 }catch(error){
  console.error('Linked ad video import failed:',error.name||'Error');
  const knownMessages=[
   'Enter a valid direct video URL.','Video links must use a public HTTPS host on the standard port.',
   'The video link redirected too many times.','The video host returned an invalid redirect.',
   'The video host did not return a playable video.','The link must point directly to an MP4 or WebM video file.',
   'Linked videos must be 20 MB or smaller.','The video host took too long to respond.',
   'The link did not contain a valid MP4 or WebM video file.'
  ];
  return res.status(400).json({error:knownMessages.includes(error.message)?error.message:'Could not download the video. Check that the link is public and try again.'})
 }
});
app.post('/api/upload',up.single('file'),async(req,res)=>{if(!req.u)return res.sendStatus(401);if(!safeImage(req.file))return res.status(415).json({error:'Choose a valid JPEG, PNG, WebP or GIF image.'});
 const id=crypto.randomBytes(16).toString('hex');await q('insert into files values($1,$2,$3)',[id,req.file.mimetype,req.file.buffer]);res.json({id})});
app.get('/_blob/:id',async(req,res)=>{const r=(await q('select mime,data from files where id=$1',[req.params.id.replace(/\W/g,'')])).rows[0];
 if(!r||!imageSignatures[r.mime]?.(r.data))return res.sendStatus(404);res.type(r.mime).set('X-Content-Type-Options','nosniff').set('Cache-Control','public,max-age=31536000,immutable').send(r.data)});
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
q('create table if not exists docs(coll text,id text,data jsonb not null,primary key(coll,id));create table if not exists files(id text primary key,mime text,data bytea)')
 .then(()=>q('create table if not exists profile_email_otps(account_id text primary key,target_email text not null,code_hash text not null,expires_at timestamptz not null,sent_at timestamptz not null,attempts integer not null default 0)'))
 .then(()=>q('create table if not exists admin_login_challenges(token_hash text primary key,user_id text not null,expires_at timestamptz not null,attempts integer not null default 0)'))
 .then(()=>q('create table if not exists admin_slots(slot smallint primary key check(slot in (1,2)),user_id text not null unique)'))
 .then(initializeAdmins)
 .then(()=>app.listen(process.env.PORT||3000,()=>console.log('Yangu Market Stores running')));
