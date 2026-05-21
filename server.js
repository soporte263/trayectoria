require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "CAMBIA_ESTE_SECRETO";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const FRONTEND_URL = (process.env.FRONTEND_URL || "https://trayectoriaconsultores.com").replace(/\/$/, "");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");

const USERS_FILE = path.join(DATA_DIR, "users.json");
const PROGRESS_FILE = path.join(DATA_DIR, "progress.json");
const CONTENT_FILE = path.join(DATA_DIR, "portal-content.json");

function ensureDir(){ if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR,{recursive:true}); }
function ensureFile(file, fallback){ ensureDir(); if(!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(fallback,null,2)); }
function readJson(file, fallback){ try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch{return fallback;} }
function writeJson(file, data){ ensureDir(); fs.writeFileSync(file, JSON.stringify(data,null,2)); }

function defaultContent(){
  return {
    blocks:[
      {id:"bloque-1",title:"Bloque 1 · Diagnóstico y punto de partida",description:"Primeros contenidos para entender tu situación actual.",videos:[
        {id:"v1",title:"Bienvenida al Programa Trayectoria",duration:"5 min",url:""},
        {id:"v2",title:"Cómo usar tu portal",duration:"6 min",url:""},
        {id:"v3",title:"Diagnóstico de trayectoria",duration:"7 min",url:""}
      ],materials:[{id:"m1",title:"Guía de diagnóstico inicial",type:"PDF",url:""}]},
      {id:"bloque-2",title:"Bloque 2 · Narrativa y posicionamiento",description:"Narrativa profesional, diferenciadores y posicionamiento.",videos:[
        {id:"v4",title:"Narrativa profesional de alto impacto",duration:"6 min",url:""},
        {id:"v5",title:"Posicionamiento ejecutivo",duration:"7 min",url:""},
        {id:"v6",title:"LinkedIn y presencia digital",duration:"6 min",url:""}
      ],materials:[{id:"m2",title:"Plantilla de narrativa profesional",type:"PDF",url:""}]},
      {id:"bloque-3",title:"Bloque 3 · CV, entrevistas y mercado",description:"Preparación para comunicar tu valor ante reclutadores.",videos:[
        {id:"v7",title:"CV estratégico por logros",duration:"6 min",url:""},
        {id:"v8",title:"Preguntas clave de entrevista",duration:"7 min",url:""},
        {id:"v9",title:"Manejo de objeciones",duration:"6 min",url:""}
      ],materials:[{id:"m3",title:"Checklist de CV y entrevista",type:"PDF",url:""}]},
      {id:"bloque-4",title:"Bloque 4 · Cierre y plan de acción",description:"Plan de acción profesional para los próximos meses.",videos:[
        {id:"v10",title:"Estrategia de búsqueda y networking",duration:"7 min",url:""},
        {id:"v11",title:"Plan de acción final",duration:"6 min",url:""}
      ],materials:[{id:"m4",title:"Plan de acción 30-60-90",type:"PDF",url:""}]}
    ]
  };
}

ensureFile(USERS_FILE, []);
ensureFile(PROGRESS_FILE, {});
ensureFile(CONTENT_FILE, defaultContent());

app.use(express.json({limit:"2mb"}));
app.use(cors({origin:[FRONTEND_URL,"https://trayectoriaconsultores.com","https://www.trayectoriaconsultores.com","http://localhost:5500","http://127.0.0.1:5500"],credentials:true}));

app.get("/", (req,res)=>res.json({ok:true,service:"Trayectoria Portal V4",dataDir:DATA_DIR}));

function createToken(user){ return jwt.sign({id:user.id,email:user.email,role:user.role||"participant"},JWT_SECRET,{expiresIn:"7d"}); }
function authRequired(req,res,next){
  const auth=req.headers.authorization||"";
  const token=auth.startsWith("Bearer ")?auth.slice(7):null;
  if(!token) return res.status(401).json({error:"No autorizado."});
  try{req.user=jwt.verify(token,JWT_SECRET);next();}catch{return res.status(401).json({error:"Sesión inválida o expirada."});}
}
function adminRequired(req,res,next){
  const pass=req.headers["x-admin-password"]||req.body?.password;
  if(!ADMIN_PASSWORD) return res.status(500).json({error:"ADMIN_PASSWORD no está configurada."});
  if(pass!==ADMIN_PASSWORD) return res.status(401).json({error:"Contraseña admin inválida."});
  next();
}
function publicUser(u){return {id:u.id,fullName:u.fullName,email:u.email,role:u.role||"participant",status:u.status||"active",createdAt:u.createdAt};}
function allVideoIds(content){return (content.blocks||[]).flatMap(b=>(b.videos||[]).map(v=>v.id));}
function getProgress(userId){
  const data=readJson(PROGRESS_FILE,{});
  if(!data[userId]){data[userId]={completedVideos:[],sessions:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};writeJson(PROGRESS_FILE,data);}
  return data[userId];
}
function saveProgress(userId,progress){const data=readJson(PROGRESS_FILE,{});data[userId]={...progress,updatedAt:new Date().toISOString()};writeJson(PROGRESS_FILE,data);}
function enrichDashboard(userId){
  const content=readJson(CONTENT_FILE,defaultContent());
  const progress=getProgress(userId);
  const completed=new Set(progress.completedVideos||[]);
  let previousComplete=true;
  const blocks=(content.blocks||[]).map((b,index)=>{
    const videos=b.videos||[];
    const unlocked=index===0||previousComplete;
    const blockComplete=videos.length>0&&videos.every(v=>completed.has(v.id));
    const item={...b,locked:!unlocked,completed:blockComplete,progress:videos.length?Math.round(videos.filter(v=>completed.has(v.id)).length/videos.length*100):0,
      videos:videos.map(v=>({...v,completed:completed.has(v.id),locked:!unlocked})),
      materials:(b.materials||[]).map(m=>({...m,locked:!unlocked}))
    };
    previousComplete=previousComplete&&blockComplete;
    return item;
  });
  const totalVideos=allVideoIds(content).length;
  const videosCompleted=(progress.completedVideos||[]).filter(id=>allVideoIds(content).includes(id)).length;
  return {progress:totalVideos?Math.round(videosCompleted/totalVideos*100):0,currentWeek:Math.min(3,Math.max(1,Math.ceil((blocks.filter(b=>!b.locked).length||1)/1.4))),totalWeeks:3,videosCompleted,totalVideos,blocks,sessions:progress.sessions||[]};
}

app.post("/participant-auth/login", async (req,res)=>{
  const {email,password}=req.body||{};
  if(!email||!password) return res.status(400).json({error:"Correo y contraseña son obligatorios."});
  const users=readJson(USERS_FILE,[]);
  const user=users.find(u=>String(u.email).toLowerCase()===String(email).toLowerCase());
  if(!user) return res.status(401).json({error:"Credenciales inválidas."});
  if((user.status||"active")!=="active") return res.status(403).json({error:"Cuenta no activa."});
  const ok=await bcrypt.compare(password,user.passwordHash);
  if(!ok) return res.status(401).json({error:"Credenciales inválidas."});
  res.json({ok:true,token:createToken(user),participant:publicUser(user)});
});

app.get("/participant/dashboard", authRequired, (req,res)=>{
  const users=readJson(USERS_FILE,[]);
  const user=users.find(u=>u.id===req.user.id);
  if(!user) return res.status(404).json({error:"Usuario no encontrado."});
  res.json({ok:true,participant:publicUser(user),dashboard:enrichDashboard(user.id)});
});

app.post("/participant/video/:videoId/complete", authRequired, (req,res)=>{
  const content=readJson(CONTENT_FILE,defaultContent());
  const ids=allVideoIds(content);
  const videoId=req.params.videoId;
  if(!ids.includes(videoId)) return res.status(404).json({error:"Video no encontrado."});
  const before=enrichDashboard(req.user.id);
  const block=before.blocks.find(b=>(b.videos||[]).some(v=>v.id===videoId));
  if(!block||block.locked) return res.status(403).json({error:"Este video aún está bloqueado."});
  const progress=getProgress(req.user.id);
  progress.completedVideos=Array.from(new Set([...(progress.completedVideos||[]),videoId]));
  saveProgress(req.user.id,progress);
  res.json({ok:true,dashboard:enrichDashboard(req.user.id)});
});

app.post("/admin/create-participant", adminRequired, async (req,res)=>{
  const {fullName,email,password}=req.body||{};
  if(!fullName||!email||!password) return res.status(400).json({error:"Nombre, correo y contraseña son obligatorios."});
  const users=readJson(USERS_FILE,[]);
  if(users.find(u=>String(u.email).toLowerCase()===String(email).toLowerCase())) return res.status(409).json({error:"Ya existe un usuario con ese correo."});
  const user={id:uuidv4(),fullName,email,passwordHash:await bcrypt.hash(password,10),role:"participant",status:"active",createdAt:new Date().toISOString()};
  users.push(user);writeJson(USERS_FILE,users);getProgress(user.id);
  res.json({ok:true,participant:publicUser(user)});
});

app.get("/admin/participants", adminRequired, (req,res)=>res.json({ok:true,participants:readJson(USERS_FILE,[]).map(publicUser)}));
app.get("/admin/portal-content", adminRequired, (req,res)=>res.json({ok:true,content:readJson(CONTENT_FILE,defaultContent())}));
app.post("/admin/portal-content", adminRequired, (req,res)=>{
  const {content}=req.body||{};
  if(!content||!Array.isArray(content.blocks)) return res.status(400).json({error:"Contenido inválido."});
  writeJson(CONTENT_FILE,content);res.json({ok:true,content});
});

app.post("/admin/participant/:participantId/sessions", adminRequired, (req,res)=>{
  const {sessions}=req.body||{};
  if(!Array.isArray(sessions)) return res.status(400).json({error:"Sesiones inválidas."});
  const progress=getProgress(req.params.participantId);
  progress.sessions=sessions;saveProgress(req.params.participantId,progress);
  res.json({ok:true,dashboard:enrichDashboard(req.params.participantId)});
});

app.listen(PORT,()=>{console.log(`Trayectoria Portal V4 escuchando en puerto ${PORT}`);console.log(`DATA_DIR usado: ${DATA_DIR}`);});
