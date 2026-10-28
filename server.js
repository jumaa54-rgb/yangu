const express=require('express'),{Pool}=require('pg'),bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken'),cp=require('cookie-parser'),multer=require('multer'),path=require('path'),crypto=require('crypto');
const SECRET=process.env.JWT_SECRET;if(!SECRET)throw new Error('Set JWT_SECRET');
const norm=e=>String(e||'').trim().toLowerCase();
const ADMIN_EMAILS=new Set((process.env.ADMIN_EMAILS||'').split(',').map(norm).filter(Boolean));
const prod=process.env.NODE_ENV==='production';
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:prod?{rejectUnauthorized:false}:false});
const q=(s,p)=>pool.query(s,p),hex=e=>Buffer.from(e).toString('hex');
const app=express();app.set('trust proxy',1);app.use(express.json({limit:'1mb'}),cp());
const up=multer({storage:multer.memoryStorage(),limits:{fileSize:3e6}});
const sign=(res,e)=>res.cookie('t',jwt.sign({e},SECRET,{expiresIn:'30d'}),{httpOnly:true,sameSite:'lax',secure:prod,maxAge:2592e6});
const pub=u=>({email:u.email,name:u.name,phone:u.phone,role:u.role}),adm=u=>u&&u.role==='admin';
const getUser=async e=>(await q("select data from docs where coll='users' and id=$1",[hex(e)])).rows[0]?.data;
app.use(async(req,res,next)=>{try{req.u=await getUser(jwt.verify(req.cookies.t,SECRET).e)||null}catch{req.u=null}next()});

app.post('/api/signup',async(req,res)=>{
 const{name,email,phone,password,q:qn,qa}=req.body,e=norm(email);
 if(!name||!/^\S+@\S+\.\S+$/.test(e)||String(phone||'').replace(/\D/g,'').length<9||String(password||'').length<6||!qa)return res.status(400).json({error:'Fill all fields correctly (valid email, phone, 6+ character password).'});
 const c=await pool.connect();
 try{await c.query('begin');
  const ins=await c.query("insert into docs values('users',$1,$2) on conflict do nothing returning 1",[hex(e),{email:e,name:String(name).slice(0,80),phone:String(phone).slice(0,30),hash:await bcrypt.hash(String(password),10),q:qn,qah:await bcrypt.hash(String(qa).toLowerCase().trim(),10),role:ADMIN_EMAILS.has(e)?'admin':'seller',created:Date.now()}]);
  if(!ins.rowCount){await c.query('rollback');return res.status(409).json({error:'This email already has an account. Please log in.'})}
  await c.query('commit');sign(res,e);res.json(pub(await getUser(e)));
 }catch(x){await c.query('rollback');console.error(x);res.status(500).json({error:'Server error'})}finally{c.release()}});
app.post('/api/login',async(req,res)=>{const e=norm(req.body.email),u=await getUser(e);
 if(!u)return res.status(404).json({error:'No account with that email.'});
 if(!await bcrypt.compare(String(req.body.password||''),u.hash))return res.status(401).json({error:'Wrong password.'});
 sign(res,e);res.json(pub(u))});
app.post('/api/logout',(req,res)=>{res.clearCookie('t');res.json({ok:1})});
app.get('/api/me',(req,res)=>res.json(req.u?pub(req.u):null));
app.post('/api/forgot',async(req,res)=>{const u=await getUser(norm(req.body.email));if(!u)return res.status(404).json({error:'No account with that email.'});res.json({q:u.q})});
app.post('/api/reset',async(req,res)=>{const e=norm(req.body.email),u=await getUser(e),pw=String(req.body.password||'');
 if(!u||pw.length<6)return res.status(400).json({error:'Password must be 6+ characters.'});
 if(!await bcrypt.compare(String(req.body.qa||'').toLowerCase().trim(),u.qah))return res.status(401).json({error:'Wrong answer.'});
 await q("update docs set data=data||$1 where coll='users' and id=$2",[{hash:await bcrypt.hash(pw,10)},hex(e)]);res.json({ok:1})});
app.post('/api/admin/reset',async(req,res)=>{if(!adm(req.u))return res.sendStatus(403);const e=norm(req.body.email),temp='Yangu'+crypto.randomInt(1000,10000);
 await q("update docs set data=data||$1 where coll='users' and id=$2",[{hash:await bcrypt.hash(temp,10)},hex(e)]);res.json({temp})});

const COLL=['products','comments','site','users'],strip=({hash,qah,...r})=>r;
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
q('create table if not exists docs(coll text,id text,data jsonb not null,primary key(coll,id));create table if not exists files(id text primary key,mime text,data bytea)')
 .then(()=>app.listen(process.env.PORT||3000,()=>console.log('Yangu Market Stores running')));
