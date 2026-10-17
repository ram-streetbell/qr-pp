import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import QRCode from 'qrcode';
import { z } from 'zod';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fetchPetpoojaMenu, submitPetpoojaOrder } from './petpooja.js';

type Table={id:string;number:string;status:'available'|'active'};
type Item={id:string;name:string;category:string;price:number;description?:string};
type Session={id:string;tableId:string;tokenHash:string;status:'active'|'closed'|'expired';createdAt:string;expiresAt:string};
type Order={id:string;sessionId:string;tableId:string;items:{menuItemId:string;name:string;quantity:number;unitPrice:number}[];total:number;status:'submitted'|'accepted'|'rejected';kotNumber?:string;petpoojaOrderId?:string;createdAt:string};
type Store={tables:Table[];menu:Item[];sessions:Session[];orders:Order[]};

const app=express();
app.use(cors({origin:process.env.CORS_ORIGIN?.split(',')||true}));
app.use(express.json({limit:'1mb'}));
const port=Number(process.env.PORT||8080),ttl=Number(process.env.QR_TTL_MINUTES||360),dbFile=process.env.DATA_FILE||'./data/store.json';
const customerPage=join(process.cwd(),'customer-web','index.html');
const defaultMenu:Item[]=[{id:'item-1',name:'Paneer Butter Masala',category:'Main Course',price:220},{id:'item-2',name:'Chicken Biryani',category:'Biryani',price:280},{id:'item-3',name:'Veg Hakka Noodles',category:'Chinese',price:190},{id:'item-4',name:'Butter Naan',category:'Breads',price:55},{id:'item-5',name:'Fresh Lime Soda',category:'Beverages',price:90}];
const defaultStore=():Store=>({tables:Array.from({length:Number(process.env.TABLE_COUNT||20)},(_,i)=>({id:`table-${i+1}`,number:String(i+1),status:'available'})),menu:defaultMenu,sessions:[],orders:[]});
let store:Store=defaultStore();
const sessions=new Map<string,Session>();const orders=new Map<string,Order>();
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');const token=()=>randomBytes(32).toString('base64url');
const getTable=(id:string)=>store.tables.find(t=>t.id===id);
const findSession=(raw:string)=>{const s=[...sessions.values()].find(x=>x.tokenHash===hash(raw));if(!s)return null;if(s.status==='active'&&new Date(s.expiresAt)<=new Date()){s.status='expired';const t=getTable(s.tableId);if(t)t.status='available';void persist()}return s};
async function persist(){try{mkdirSync('./data',{recursive:true});store.sessions=[...sessions.values()];store.orders=[...orders.values()];await writeFile(dbFile,JSON.stringify(store,null,2),'utf8')}catch{}}
async function boot(){if(existsSync(dbFile)){try{store=JSON.parse(await readFile(dbFile,'utf8'))}catch{store=defaultStore()}}for(const s of store.sessions||[])sessions.set(s.id,s);for(const o of store.orders||[])orders.set(o.id,o);for(const t of store.tables||[])t.status=[...sessions.values()].some(s=>s.tableId===t.id&&s.status==='active')?'active':'available'}

app.get('/health',(_,res)=>res.json({ok:true,petpoojaConfigured:Boolean(process.env.PETPOOJA_APP_KEY&&process.env.PETPOOJA_APP_SECRET&&process.env.PETPOOJA_ACCESS_TOKEN&&process.env.PETPOOJA_REST_ID)}));
app.get('/api/tables',(_,res)=>res.json({tables:store.tables}));
app.get('/api/menu',(_,res)=>res.json({items:store.menu}));
app.get('/order/:rawToken',(_,res)=>res.sendFile(customerPage));
app.get('/api/tables/:tableId/session',(req,res)=>{const s=[...sessions.values()].find(x=>x.tableId===req.params.tableId&&x.status==='active');if(!s)return res.status(404).json({error:'NO_ACTIVE_SESSION'});res.json({sessionId:s.id,expiresAt:s.expiresAt})});

app.post('/api/tables/:tableId/session',async(req,res)=>{const t=getTable(req.params.tableId);if(!t)return res.status(404).json({error:'TABLE_NOT_FOUND'});if(t.status==='active')return res.status(409).json({error:'TABLE_ALREADY_ACTIVE'});const raw=token(),now=new Date(),expires=new Date(now.getTime()+ttl*60000);const s:Session={id:randomUUID(),tableId:t.id,tokenHash:hash(raw),status:'active',createdAt:now.toISOString(),expiresAt:expires.toISOString()};sessions.set(s.id,s);t.status='active';await persist();const base=process.env.PUBLIC_BASE_URL||`http://localhost:${port}`,url=`${base}/order/${raw}`,qrDataUrl=await QRCode.toDataURL(url,{width:700,margin:2});res.status(201).json({sessionId:s.id,table:t,expiresAt:s.expiresAt,url,qrDataUrl})});
app.post('/api/sessions/:sessionId/close',async(req,res)=>{const s=sessions.get(req.params.sessionId);if(!s)return res.status(404).json({error:'SESSION_NOT_FOUND'});s.status='closed';const t=getTable(s.tableId);if(t)t.status='available';await persist();res.json({ok:true})});
app.get('/api/public/session/:rawToken',(req,res)=>{const s=findSession(req.params.rawToken);if(!s||s.status!=='active')return res.status(410).json({error:'QR_INACTIVE'});const t=getTable(s.tableId);res.json({sessionId:s.id,table:{id:t?.id,number:t?.number},expiresAt:s.expiresAt,items:store.menu})});

const orderSchema=z.object({items:z.array(z.object({menuItemId:z.string(),quantity:z.number().int().min(1).max(50)})).min(1)});
app.post('/api/public/session/:rawToken/orders',async(req,res)=>{const s=findSession(req.params.rawToken);if(!s||s.status!=='active')return res.status(410).json({error:'QR_INACTIVE'});const parsed=orderSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'INVALID_ORDER',details:parsed.error.flatten()});const items:Order['items']=[];let total=0;for(const x of parsed.data.items){const m=store.menu.find(i=>i.id===x.menuItemId);if(!m)return res.status(400).json({error:'MENU_ITEM_NOT_FOUND'});items.push({menuItemId:m.id,name:m.name,quantity:x.quantity,unitPrice:m.price});total+=m.price*x.quantity}const order:Order={id:randomUUID(),sessionId:s.id,tableId:s.tableId,items,total,status:'submitted',createdAt:new Date().toISOString()};orders.set(order.id,order);await persist();try{if(process.env.PETPOOJA_MODE==='mock'){order.kotNumber=`KOT-${Math.floor(1000+Math.random()*9000)}`;order.status='accepted';await persist();return res.status(201).json({order})}const result=await submitPetpoojaOrder({clientOrderId:order.id,tableNumber:getTable(s.tableId)?.number||'',items:order.items,total:order.total,callbackUrl:process.env.PETPOOJA_CALLBACK_URL});order.status='accepted';if(result?.orderID)order.petpoojaOrderId=String(result.orderID);if(result?.kotNumber)order.kotNumber=String(result.kotNumber);await persist();return res.status(201).json({order,petpooja:result})}catch(e){order.status='rejected';await persist();return res.status(502).json({error:'PETPOOJA_SUBMISSION_FAILED',message:e instanceof Error?e.message:'Unknown error',orderId:order.id})}});
app.get('/api/sessions/:sessionId/orders',(req,res)=>{const s=sessions.get(req.params.sessionId);if(!s)return res.status(404).json({error:'SESSION_NOT_FOUND'});res.json({orders:[...orders.values()].filter(o=>o.sessionId===s.id)})});
app.get('/api/orders/:orderId',(req,res)=>{const o=orders.get(req.params.orderId);if(!o)return res.status(404).json({error:'ORDER_NOT_FOUND'});res.json({order:o})});
app.post('/api/petpooja/menu/sync',async(_,res)=>{try{return res.json({ok:true,result:await fetchPetpoojaMenu()})}catch(e){return res.status(502).json({ok:false,error:e instanceof Error?e.message:'Unknown error'})}});
app.post('/api/petpooja/callback',async(req,res)=>{const externalId=String(req.body?.orderID||'');const order=[...orders.values()].find(o=>o.id===externalId||o.petpoojaOrderId===externalId);if(order){const status=Number(req.body?.status);if(status===-1)order.status='rejected';else if(status===1||status===2||status===3||status===4||status===5||status===10)order.status='accepted';await persist()}res.json({ok:true})});

await boot();app.listen(port,()=>console.log(`QR-PP backend listening on :${port}`));
