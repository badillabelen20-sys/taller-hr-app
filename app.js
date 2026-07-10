/* ================= HR Turbos y Servicios — Sistema =================
   Datos en Supabase (nube). Login real + acceso multi-PC.
=================================================================== */

const SUPA_URL = 'https://rukruucfdzfloituvnjg.supabase.co';
const SUPA_KEY = 'sb_publishable_QJhQluf6pZaHVD-dm48H3Q_-he9BH9j';

/* ---------- Utilidades ---------- */
const $  = (s, c=document) => c.querySelector(s);
const $$ = (s, c=document) => [...c.querySelectorAll(s)];
function uuidv4(){ return (window.crypto&&crypto.randomUUID)?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0,v=c==='x'?r:(r&0x3|0x8);return v.toString(16);}); }
const uid = () => uuidv4();
const b64  = s => btoa(unescape(encodeURIComponent(s||'')));   // texto -> base64 (seguro p/ onclick)
const unb64= s => decodeURIComponent(escape(atob(s||'')));
const clientKey = v => v.rubro==='turbo' ? (v.cliente||'Consumidor final') : (v.patente||v.vehiculo||v.cliente||'Sin identificar');
const money = n => new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(n||0);
const num   = n => new Intl.NumberFormat('es-AR').format(n||0);
const todayISO = () => new Date().toISOString().slice(0,10);
function fmtDate(iso){
  const d = new Date(iso+'T00:00:00');
  return d.toLocaleDateString('es-AR',{day:'2-digit',month:'short',year:'numeric'});
}
function fmtDay(iso){
  const d = new Date(iso+'T00:00:00');
  return d.toLocaleDateString('es-AR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'})
          .replace(/^\w/,c=>c.toUpperCase());
}
const MES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const round10 = x => Math.round((x||0)/10)*10;   // redondeo a $10

// Métodos de pago y recargos
const PAY = [
  {key:'efectivo',      lbl:'EFECTIVO',        name:'Efectivo',      f:1,     cls:'cash'},
  {key:'transferencia', lbl:'TRANSFERENCIA',   name:'Transferencia', f:1,     cls:'transf'},
  {key:'debito',        lbl:'DÉBITO (6%)',     name:'Débito',        f:1.06,  cls:'deb'},
  {key:'credito',       lbl:'CRÉDITO (9,6%)',  name:'Crédito',       f:1.096, cls:'cred'},
];

/* ================= Conexión a Supabase (nube) ================= */
const supa = window.supabase.createClient(SUPA_URL, SUPA_KEY);
const TABLES = ['productos','proveedores','compras','ventas','recepciones','gastos','movimientos'];
const FIELDMAP = {
  productos:{stockMin:'stock_min'},
  ventas:{recepcionId:'recepcion_id'},
  recepciones:{costoPresupuesto:'costo_presupuesto', ventaId:'venta_id'},
  compras:{proveedorId:'proveedor_id', productoId:'producto_id'},
  movimientos:{productoId:'producto_id'}, gastos:{}, proveedores:{}
};
const NUMFIELDS = {
  productos:['costo','precio','stock','stockMin'], ventas:['kilometros','recargo','total'],
  recepciones:['costoPresupuesto'], compras:['cantidad','costo'], gastos:['monto'],
  movimientos:['cantidad'], proveedores:[]
};
const emptyDB = () => ({productos:[],proveedores:[],compras:[],ventas:[],recepciones:[],gastos:[],movimientos:[],usuarios:[]});
let DB = emptyDB();

function toRow(t,o){ const fm=FIELDMAP[t]||{}, r={}; for(const k in o){ if(o[k]===undefined)continue; r[fm[k]||k]=o[k]; } return r; }
function toApp(t,r){ const fm=FIELDMAP[t]||{}, inv={}; for(const k in fm) inv[fm[k]]=k; const o={};
  for(const k in r){ if(k==='created_at')continue; o[inv[k]||k]=r[k]; }
  (NUMFIELDS[t]||[]).forEach(f=>{ if(o[f]!=null && o[f]!=='') o[f]=Number(o[f]); });
  return o;
}

let SNAP={};
function snapshot(){ SNAP={}; for(const t of TABLES) SNAP[t]=new Map(DB[t].map(x=>[x.id, JSON.stringify(toRow(t,x))])); }

async function fetchAllRows(t){
  const size=1000; let from=0, all=[];
  while(true){
    const { data, error } = await supa.from(t).select('*').range(from, from+size-1);
    if(error) throw error;                 // aborta la carga: NO deja la tabla a medias
    all = all.concat(data||[]);
    if(!data || data.length < size) break;
    from += size;
  }
  return all;
}
function backupLocal(){ try{ localStorage.setItem('turbolub_backup', JSON.stringify({at:Date.now(), db:DB})); }catch(e){} }

async function loadAll(){
  const fresh={};
  for(const t of TABLES){ fresh[t] = (await fetchAllRows(t)).map(r=>toApp(t,r)); }
  const perf = await fetchAllRows('perfiles');
  for(const t of TABLES) DB[t]=fresh[t];   // se aplica SOLO si todas las tablas cargaron bien
  DB.usuarios = perf.map(p=>({id:p.id,nombre:p.nombre||'',usuario:p.nombre||'',rol:p.rol||'Integrante'}));
  snapshot(); backupLocal();
}

// Cola única: guardados y recargas se ejecutan en orden y NO se pisan (evita pérdida de datos)
let opQ=Promise.resolve();
function runQueued(fn){ opQ = opQ.then(fn).catch(e=>console.error('sync',e)); return opQ; }

async function persistOnce(){
  for(const t of TABLES){
    const cur=DB[t], prev=SNAP[t]||new Map(), up=[], curIds=new Set();
    for(const o of cur){ curIds.add(o.id); const rs=JSON.stringify(toRow(t,o)); if(prev.get(o.id)!==rs) up.push(toRow(t,o)); }
    const del=[]; for(const id of prev.keys()) if(!curIds.has(id)) del.push(id);
    if(up.length){ const {error}=await supa.from(t).upsert(up); if(error) throw error; }
    if(del.length){ const {error}=await supa.from(t).delete().in('id',del); if(error) throw error; }
  }
  snapshot(); backupLocal();   // marca "guardado" SOLO cuando todo se guardó de verdad
}
async function persistWithRetry(){
  for(let i=0;i<5;i++){
    try{ await persistOnce(); return; }
    catch(e){ console.error('guardado intento '+(i+1), e);
      if(i<4) await new Promise(r=>setTimeout(r,1500*(i+1)));
      else toast('⚠ Sin conexión: los últimos cambios NO se guardaron. Revisá internet y volvé a intentar.');
    }
  }
}

function seed(){
  const hoy = new Date();
  const d = off => { const x=new Date(hoy); x.setDate(x.getDate()-off); return x.toISOString().slice(0,10); };
  return {
    productos:[
      {id:uid(),nombre:'Turbo Garrett GT1749V',sku:'TBO-1001',rubro:'turbo',tipo:'Turbo nuevo',costo:280000,precio:420000,stock:4,stockMin:2},
      {id:uid(),nombre:'Turbo Holset HX35',sku:'TBO-1002',rubro:'turbo',tipo:'Turbo nuevo',costo:350000,precio:540000,stock:1,stockMin:2},
      {id:uid(),nombre:'Kit de reparación turbo',sku:'TBO-2001',rubro:'turbo',tipo:'Repuesto',costo:38000,precio:72000,stock:12,stockMin:5},
      {id:uid(),nombre:'Cartucho / CHRA universal',sku:'TBO-2002',rubro:'turbo',tipo:'Repuesto',costo:120000,precio:195000,stock:0,stockMin:2},
      {id:uid(),nombre:'Actuador wastegate',sku:'TBO-2003',rubro:'turbo',tipo:'Repuesto',costo:24000,precio:45000,stock:6,stockMin:3},
      {id:uid(),nombre:'Aceite 15W40 mineral x4L',sku:'LUB-3001',rubro:'lubricentro',tipo:'Aceite',costo:9500,precio:16500,stock:24,stockMin:10},
      {id:uid(),nombre:'Aceite 5W30 sintético x4L',sku:'LUB-3002',rubro:'lubricentro',tipo:'Aceite',costo:16000,precio:28000,stock:8,stockMin:10},
      {id:uid(),nombre:'Filtro de aceite',sku:'LUB-4001',rubro:'lubricentro',tipo:'Filtro',costo:3200,precio:6500,stock:40,stockMin:15},
      {id:uid(),nombre:'Filtro de aire',sku:'LUB-4002',rubro:'lubricentro',tipo:'Filtro',costo:4800,precio:9800,stock:3,stockMin:10},
      {id:uid(),nombre:'Filtro de combustible',sku:'LUB-4003',rubro:'lubricentro',tipo:'Filtro',costo:5200,precio:10500,stock:0,stockMin:8},
    ],
    ventas:[
      {id:uid(),fecha:d(0),rubro:'turbo',cliente:'Transportes del Sur',vehiculo:'Iveco Daily',metodo:'Transferencia',items:[{nombre:'Reparación turbo Garrett',cantidad:1,precio:210000},{nombre:'Kit de reparación turbo',cantidad:1,precio:72000}],total:282000},
      {id:uid(),fecha:d(0),rubro:'lubricentro',cliente:'Juan Pérez',vehiculo:'VW Amarok',metodo:'Efectivo',items:[{nombre:'Cambio de aceite + service',cantidad:1,precio:18000},{nombre:'Aceite 5W30 sintético x4L',cantidad:1,precio:28000},{nombre:'Filtro de aceite',cantidad:1,precio:6500}],total:52500},
      {id:uid(),fecha:d(1),rubro:'lubricentro',cliente:'María Gómez',vehiculo:'Ford Focus',metodo:'Débito',items:[{nombre:'Cambio de aceite',cantidad:1,precio:15000},{nombre:'Aceite 15W40 mineral x4L',cantidad:1,precio:16500},{nombre:'Filtro de aceite',cantidad:1,precio:6500}],total:38000},
      {id:uid(),fecha:d(2),rubro:'turbo',cliente:'Agro Norte',vehiculo:'John Deere',metodo:'Efectivo',items:[{nombre:'Turbo Holset HX35',cantidad:1,precio:540000}],total:540000},
      {id:uid(),fecha:d(3),rubro:'lubricentro',cliente:'Carlos Ruiz',vehiculo:'Toyota Hilux',metodo:'Efectivo',items:[{nombre:'Cambio de aceite + filtros',cantidad:1,precio:22000},{nombre:'Filtro de aire',cantidad:1,precio:9800}],total:31800},
      {id:uid(),fecha:d(6),rubro:'turbo',cliente:'Logística Andina',vehiculo:'Mercedes Sprinter',metodo:'Transferencia',items:[{nombre:'Balanceo de turbo',cantidad:1,precio:95000},{nombre:'Actuador wastegate',cantidad:1,precio:45000}],total:140000},
      {id:uid(),fecha:d(9),rubro:'lubricentro',cliente:'Ana Torres',vehiculo:'Chevrolet Onix',metodo:'Débito',items:[{nombre:'Cambio de aceite',cantidad:1,precio:15000},{nombre:'Aceite 15W40 mineral x4L',cantidad:1,precio:16500}],total:31500},
    ],
    settings:{negocio:'TurboLub', dueno:'Encargado'}
  };
}
function seedRecepciones(){
  const hoy=new Date();
  const d=off=>{const x=new Date(hoy);x.setDate(x.getDate()-off);return x.toISOString().slice(0,10);};
  return [
    {id:uid(),ingreso:d(5),cliente:'Transportes del Sur',telefono:'351-5551234',vehiculo:'Iveco Daily',
     presupuestado:true,costoPresupuesto:282000,productos:[{nombre:'Kit de reparación turbo',cantidad:1}],
     entregado:true,entrega:d(1),pagado:true,metodo:'Transferencia',notas:'Reparación turbo Garrett'},
    {id:uid(),ingreso:d(3),cliente:'Logística Andina',telefono:'351-5559876',vehiculo:'Mercedes Sprinter',
     presupuestado:true,costoPresupuesto:140000,productos:[{nombre:'Actuador wastegate',cantidad:1}],
     entregado:false,entrega:'',pagado:false,metodo:'',notas:'Balanceo de turbo'},
    {id:uid(),ingreso:d(1),cliente:'Agro Norte',telefono:'351-5550000',vehiculo:'John Deere 5075',
     presupuestado:false,costoPresupuesto:0,productos:[],
     entregado:false,entrega:'',pagado:false,metodo:'',notas:'A la espera de diagnóstico'},
  ];
}
function seedAdmin(){
  const hoy=new Date(); const d=off=>{const x=new Date(hoy);x.setDate(x.getDate()-off);return x.toISOString().slice(0,10);};
  const p1={id:uid(),nombre:'Turbos Import SA',contacto:'Ventas',telefono:'11-4444-5555',rubro:'Turbos y repuestos',notas:''};
  const p2={id:uid(),nombre:'Distribuidora Lubricantes del Centro',contacto:'Pedidos',telefono:'351-222-3333',rubro:'Aceites y filtros',notas:''};
  const p3={id:uid(),nombre:'Repuestos González',contacto:'Mostrador',telefono:'351-777-8888',rubro:'Repuestos varios',notas:''};
  return {
    proveedores:[p1,p2,p3],
    compras:[
      {id:uid(),proveedorId:p2.id,fecha:d(4),detalle:'Aceite 15W40 x2 tambores',costo:190000,saldado:true,metodo:'Transferencia'},
      {id:uid(),proveedorId:p1.id,fecha:d(8),detalle:'2 turbos Garrett',costo:560000,saldado:false,metodo:''},
      {id:uid(),proveedorId:p3.id,fecha:d(2),detalle:'Filtros varios',costo:45000,saldado:true,metodo:'Efectivo'},
    ],
    gastos:[
      {id:uid(),fecha:d(1),tipo:'Alquiler',detalle:'Alquiler del local',monto:180000,metodo:'Transferencia'},
      {id:uid(),fecha:d(3),tipo:'Servicios (luz/agua/internet)',detalle:'Factura de luz',monto:42000,metodo:'Débito'},
      {id:uid(),fecha:d(0),tipo:'Gastos chicos',detalle:'Café, limpieza',monto:8000,metodo:'Efectivo'},
    ]
  };
}
function seedUsuarios(){ return [{id:uid(),usuario:'admin',password:'admin',nombre:'Administrador',rol:'Dueño'}]; }
function load(){
  try{ const raw = localStorage.getItem(LS_KEY); if(raw){ const d=JSON.parse(raw); let mig=false;
        if(!d.movimientos){ d.movimientos=[]; mig=true; } if(!d.recepciones){ d.recepciones=seedRecepciones(); mig=true; }
        if(!d.proveedores){ Object.assign(d, seedAdmin()); mig=true; }
        if(!d.usuarios){ d.usuarios=seedUsuarios(); mig=true; }
        if(mig) localStorage.setItem(LS_KEY, JSON.stringify(d)); return d; } }catch(e){}
  const s = seed(); s.movimientos=[]; s.recepciones=seedRecepciones(); Object.assign(s, seedAdmin()); s.usuarios=seedUsuarios();
  localStorage.setItem(LS_KEY, JSON.stringify(s)); return s;
}
function save(){ backupLocal(); runQueued(persistWithRetry); }

/* ---------- Helpers de negocio ---------- */
function estadoStock(p){
  if(p.stock<=0) return {cls:'off', txt:'Sin stock'};
  if(p.stock<=p.stockMin) return {cls:'warn', txt:'Stock bajo'};
  return {cls:'ok', txt:'En stock'};
}
function ventasFiltro(rubro){
  let v = [...DB.ventas];
  if(rubro && rubro!=='todos') v = v.filter(x=>x.rubro===rubro);
  return v.sort((a,b)=> b.fecha.localeCompare(a.fecha) || b.id.localeCompare(a.id));
}
function totalPeriodo({rubro, year, month}={}){
  return DB.ventas.filter(v=>{
    if(rubro && v.rubro!==rubro) return false;
    const d=new Date(v.fecha+'T00:00:00');
    if(year!=null && d.getFullYear()!==year) return false;
    if(month!=null && d.getMonth()!==month) return false;
    return true;
  }).reduce((s,v)=>s+v.total,0);
}
function countPeriodo({rubro, year, month}={}){
  return DB.ventas.filter(v=>{
    if(rubro && v.rubro!==rubro) return false;
    const d=new Date(v.fecha+'T00:00:00');
    if(year!=null && d.getFullYear()!==year) return false;
    if(month!=null && d.getMonth()!==month) return false;
    return true;
  }).length;
}
// Costo de la mercadería vendida (usa el costo cargado en cada producto)
function costoPeriodo({rubro, year, month}={}){
  let c=0;
  DB.ventas.forEach(v=>{
    if(rubro && v.rubro!==rubro) return;
    const d=new Date(v.fecha+'T00:00:00');
    if(year!=null && d.getFullYear()!==year) return;
    if(month!=null && d.getMonth()!==month) return;
    const src=(v.insumos&&v.insumos.length)?v.insumos:(v.items||[]);
    src.forEach(it=>{ const p=DB.productos.find(x=>x.nombre===it.nombre); if(p) c+=(+p.costo||0)*(+it.cantidad||0); });
  });
  return c;
}
function gastosPeriodo({year, month}={}){
  return DB.gastos.filter(g=>{ const d=new Date(g.fecha+'T00:00:00');
    if(year!=null && d.getFullYear()!==year) return false;
    if(month!=null && d.getMonth()!==month) return false; return true;
  }).reduce((s,g)=>s+(+g.monto||0),0);
}

/* ================= Router / navegación ================= */
let current = 'inicio';
let saleFilter = 'todos';
let stockFilter = 'todos';
let diaryFilter = 'turbo';
let recFilter = 'todos';
let clientFilter = 'turbo';
const ymNow = () => new Date().toISOString().slice(0,7);
let gastoMonth = ymNow();
let cajaMonth  = ymNow();
const GASTO_TIPOS = ['Proveedor / Mercadería','Alquiler','Servicios (luz/agua/internet)','Sueldos','Impuestos','Mantenimiento','Gastos chicos','Otros'];
function monthKey(iso){ return (iso||'').slice(0,7); }
function fmtMonth(ym){ const [y,m]=ym.split('-'); return MES[+m-1]+' '+y; }
function monthOptions(sel){
  const out=[]; const now=new Date();
  for(let i=0;i<12;i++){ const dt=new Date(now.getFullYear(),now.getMonth()-i,1); const ym=dt.toISOString().slice(0,7); out.push(`<option value="${ym}" ${ym===sel?'selected':''}>${fmtMonth(ym)}</option>`); }
  return out.join('');
}
function nombreProveedor(id){ const p=DB.proveedores.find(x=>x.id===id); return p?p.nombre:'—'; }

function toggleSidebar(){ $('.sidebar').classList.toggle('open'); $('#sbBackdrop').classList.toggle('show'); }
function closeSidebar(){ const s=$('.sidebar'); if(s&&s.classList.contains('open')){ s.classList.remove('open'); $('#sbBackdrop').classList.remove('show'); } }

function go(view, opts={}){
  current = view;
  if(opts.rubro){ if(view==='stock') stockFilter=opts.rubro; if(view==='ventas') saleFilter=opts.rubro; if(view==='diario') diaryFilter=opts.rubro==='todos'?'turbo':opts.rubro; }
  const want = opts.rubro || null;
  $$('.nav-item').forEach(b=>b.classList.toggle('active', b.dataset.view===view && (b.dataset.rubro||null)===want));
  closeSidebar();
  render();
}

function render(){
  const el = $('#content');
  const map = {inicio:viewInicio, ventas:viewVentas, stock:viewStock, recepcion:viewRecepcion, diario:viewDiario, resumen:viewResumen, clientes:viewClientes, proveedores:viewProveedores, gastos:viewGastos, caja:viewCaja, config:viewConfig};
  el.innerHTML = (map[current]||viewInicio)();
  wireView();
  // actualizar badge de stock bajo
  const bajos = DB.productos.filter(p=>p.stock<=p.stockMin).length;
  const badge = $('#stockBadge'); if(badge){ badge.textContent = bajos; badge.classList.toggle('hide', bajos===0); }
  // badge de turbos en taller sin entregar
  const enTaller = DB.recepciones.filter(r=>!r.entregado).length;
  const rb = $('#recBadge'); if(rb){ rb.textContent = enTaller; rb.classList.toggle('hide', enTaller===0); }
}

/* ================= Vistas ================= */

/* ---- INICIO / Dashboard ---- */
function viewInicio(){
  const now = new Date(), y=now.getFullYear(), m=now.getMonth();
  const mesTot   = totalPeriodo({year:y,month:m});
  const anioTot  = totalPeriodo({year:y});
  const turboMes = totalPeriodo({rubro:'turbo',year:y,month:m});
  const lubriMes = totalPeriodo({rubro:'lubricentro',year:y,month:m});
  const nBajos   = DB.productos.filter(p=>p.stock<=p.stockMin).length;

  return `
  <div class="page-head">
    <div><h1>Inicio</h1><p>Resumen general del taller de turbos y lubricentro</p></div>
    <div class="actions">
      <button class="btn" onclick="go('resumen')">📊 Ver reportes</button>
      <button class="btn primary" onclick="openSale()">＋ Nueva venta</button>
    </div>
  </div>
  ${statsRow([
    {ic:'💵', lbl:'Ventas del mes', val:money(mesTot), delta:'+12,5%', up:true, per:MES[m]+' '+y},
    {ic:'📅', lbl:'Ventas del año', val:money(anioTot), delta:'+8,2%', up:true, per:'Año '+y},
    {ic:'🌀', lbl:'Turbos (mes)', val:money(turboMes), delta:'+4,2%', up:true, per:MES[m]},
    {ic:'🛢️', lbl:'Lubricentro (mes)', val:money(lubriMes), delta:'-1,4%', up:false, per:MES[m]},
  ])}

  <div class="two-col">
    <div class="card">
      <h3>Ventas por mes — ${y}</h3>
      <div class="csub">Comparativa de turbos y lubricentro</div>
      ${barChart(y)}
      <div class="legend"><span><i class="turbo"></i>Turbos</span><span><i class="lubri"></i>Lubricentro</span></div>
    </div>
    <div class="card">
      <h3>Más vendidos del mes</h3>
      <div class="csub">Top productos y servicios</div>
      ${topList(y,m)}
    </div>
  </div>

  <div class="two-col">
    <div class="card">
      <div class="items-head"><h3 style="margin:0">Últimas ventas</h3><button class="btn sm" onclick="go('ventas')">Ver todas</button></div>
      ${miniVentas(ventasFiltro('todos').slice(0,5))}
    </div>
    <div class="card">
      <div class="items-head"><h3 style="margin:0">Alertas de stock</h3><button class="btn sm" onclick="go('stock')">Ir a stock</button></div>
      ${alertasStock()}
      ${nBajos===0?'<p class="muted" style="margin:8px 0 0">Todo el stock está en niveles correctos ✅</p>':''}
    </div>
  </div>`;
}

function statsRow(cards){
  return `<div class="stats">${cards.map(c=>`
    <div class="stat">
      <div class="s-top"><span class="si">${c.ic}</span>${c.lbl}<span class="dots">⋯</span></div>
      <div class="s-val">${c.val}</div>
      <div class="s-foot"><span class="delta ${c.up?'up':'down'}">${c.up?'▲':'▼'} ${c.delta}</span><span class="period">${c.per}</span></div>
    </div>`).join('')}</div>`;
}

function barChart(year){
  const data = MES.map((_,mi)=>({
    turbo: totalPeriodo({rubro:'turbo',year,month:mi}),
    lubri: totalPeriodo({rubro:'lubricentro',year,month:mi})
  }));
  const max = Math.max(1, ...data.map(d=>Math.max(d.turbo,d.lubri)));
  return `<div class="chart">${data.map((d,i)=>`
    <div class="col">
      <div class="bars">
        <div class="bar turbo" style="height:${Math.max(2,d.turbo/max*100)}%" title="Turbos ${MES[i]}: ${money(d.turbo)}"></div>
        <div class="bar lubri" style="height:${Math.max(2,d.lubri/max*100)}%" title="Lubricentro ${MES[i]}: ${money(d.lubri)}"></div>
      </div>
      <div class="lbl">${MES[i]}</div>
    </div>`).join('')}</div>`;
}

function topList(year,month){
  const acc={};
  DB.ventas.forEach(v=>{
    const d=new Date(v.fecha+'T00:00:00');
    if(d.getFullYear()!==year||d.getMonth()!==month) return;
    v.items.forEach(it=>{ acc[it.nombre]=(acc[it.nombre]||0)+it.precio*it.cantidad; });
  });
  const arr=Object.entries(acc).sort((a,b)=>b[1]-a[1]).slice(0,5);
  if(!arr.length) return '<p class="muted">Sin ventas este mes.</p>';
  const max=arr[0][1];
  const colors=['#6d5ae6','#7c6cf5','#d9902a','#1a9d6b','#2f6bd8'];
  return `<div class="rowlist">${arr.map(([n,val],i)=>`
    <div class="rl">
      <div class="rl-ic" style="background:${colors[i]}22;color:${colors[i]}">${i+1}</div>
      <div class="rl-main">
        <div class="rl-name"><span>${n}</span><span class="strong">${money(val)}</span></div>
        <div class="rl-bar"><i style="width:${val/max*100}%;background:${colors[i]}"></i></div>
      </div>
    </div>`).join('')}</div>`;
}

function miniVentas(list){
  if(!list.length) return '<p class="muted">Sin ventas registradas.</p>';
  return `<table><tbody>${list.map(v=>`
    <tr>
      <td class="cell-name"><div class="thumb">${v.rubro==='turbo'?'🌀':'🛢️'}</div>
        <div><div class="t">${v.cliente||'Consumidor final'}</div><div class="sub">${v.vehiculo||''} · ${fmtDate(v.fecha)}</div></div></td>
      <td class="right strong mono">${money(v.total)}</td>
    </tr>`).join('')}</tbody></table>`;
}

function alertasStock(){
  const bajos = DB.productos.filter(p=>p.stock<=p.stockMin).sort((a,b)=>a.stock-b.stock).slice(0,6);
  if(!bajos.length) return '';
  return `<table><tbody>${bajos.map(p=>{const e=estadoStock(p);return `
    <tr>
      <td class="cell-name"><div class="thumb">${p.rubro==='turbo'?'🌀':'🛢️'}</div>
        <div><div class="t">${p.nombre}</div><div class="sub">${p.sku}</div></div></td>
      <td class="right"><span class="pill ${e.cls}">${e.txt}</span> <span class="muted mono">· ${p.stock} u.</span></td>
    </tr>`}).join('')}</tbody></table>`;
}

/* ---- VENTAS ---- */
function viewVentas(){
  const list = ventasFiltro(saleFilter);
  return `
  <div class="page-head">
    <div><h1>Ventas</h1><p>Registrá y consultá las ventas de turbos y lubricentro</p></div>
    <div class="actions">
      <button class="btn" onclick="exportCSV('ventas')">⭳ Exportar</button>
      <button class="btn primary" onclick="openSale()">＋ Nueva venta</button>
    </div>
  </div>
  ${posPanel()}
  <div class="panel" style="margin-top:16px">
    <div class="panel-tools">
      <div class="mini-search">${iconSearch()}<input id="qVenta" placeholder="Buscar por cliente, vehículo o ítem"></div>
      ${seg('saleFilter',[['todos','Todas'],['turbo','Turbos'],['lubricentro','Lubricentro']], v=>go('ventas',{rubro:v}) )}
    </div>
    <table>
      <thead><tr>
        <th>Cliente / Vehículo</th><th>Rubro</th><th>Detalle</th><th>Fecha</th><th>Pago</th><th class="right">Total</th><th></th>
      </tr></thead>
      <tbody id="ventasBody">${rowsVentas(list)}</tbody>
    </table>
    <div class="table-foot"><span>${list.length} venta(s)</span></div>
  </div>`;
}
function rowsVentas(list){
  if(!list.length) return `<tr><td colspan="7"><div class="empty"><div class="big">🧾</div>No hay ventas registradas.<br><button class="btn primary sm" style="margin-top:12px" onclick="openSale()">＋ Registrar venta</button></div></td></tr>`;
  return list.map(v=>`
    <tr>
      <td class="cell-name"><div class="thumb">${v.rubro==='turbo'?'🌀':'🛢️'}</div>
        <div><div class="t">${v.cliente||'Consumidor final'}</div><div class="sub">${v.vehiculo||'—'}</div></div></td>
      <td><span class="tag ${v.rubro==='turbo'?'turbo':'lubri'}">${v.rubro==='turbo'?'Turbos':'Lubricentro'}</span></td>
      <td class="muted">${v.items.map(i=>`${i.cantidad>1?i.cantidad+'× ':''}${i.nombre}`).join(', ').slice(0,60)}${v.items.map(i=>i.nombre).join(', ').length>60?'…':''}</td>
      <td class="muted mono">${fmtDate(v.fecha)}</td>
      <td class="muted">${v.metodo||'—'}</td>
      <td class="right strong mono">${money(v.total)}</td>
      <td class="right" style="white-space:nowrap">
        <button class="rowbtn" onclick="openVentaEdit('${v.id}')">Editar</button>
        <button class="rowbtn del" onclick="delVenta('${v.id}')">Eliminar</button></td>
    </tr>`).join('');
}

/* ---- Editar una venta ---- */
function openVentaEdit(id){
  const v=DB.ventas.find(x=>x.id===id); if(!v) return;
  const it=(v.items&&v.items[0])||{nombre:'',cantidad:1,precio:0};
  $('#modalRoot').innerHTML=`
  <div class="modal" style="max-width:560px">
    <div class="modal-head"><div><h2>Editar venta</h2><p>Corregí los datos de esta operación</p></div>
      <button class="x" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <input type="hidden" id="ev-id" value="${v.id}">
      <div class="field"><label>Producto / detalle</label><input id="ev-detalle" value="${(it.nombre||'').replace(/"/g,'&quot;')}"></div>
      <div class="grid2">
        <div class="field"><label>Rubro</label>
          <select id="ev-rubro"><option value="lubricentro" ${v.rubro==='lubricentro'?'selected':''}>Lubricentro</option><option value="turbo" ${v.rubro==='turbo'?'selected':''}>Turbos</option></select></div>
        <div class="field"><label>Fecha</label><input type="date" id="ev-fecha" value="${v.fecha}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Cliente</label><input id="ev-cliente" value="${(v.cliente||'').replace(/"/g,'&quot;')}"></div>
        <div class="field"><label>Vehículo</label><input id="ev-vehiculo" value="${(v.vehiculo||'').replace(/"/g,'&quot;')}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Patente</label><input id="ev-patente" value="${(v.patente||'').replace(/"/g,'&quot;')}" style="text-transform:uppercase"></div>
        <div class="field"><label>Método de pago</label>
          <select id="ev-metodo">${['Efectivo','Transferencia','Débito','Crédito','Cuenta corriente'].map(x=>`<option ${v.metodo===x?'selected':''}>${x}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Monto total ($)</label><input type="number" min="0" step="any" id="ev-total" value="${v.total}"></div>
    </div>
    <div class="modal-foot">
      <button class="btn danger" style="margin-right:auto" onclick="delVenta('${v.id}')">Eliminar</button>
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn primary" onclick="saveVentaEdit()">Guardar cambios</button>
    </div>
  </div>`;
  showModal();
}
function saveVentaEdit(){
  const v=DB.ventas.find(x=>x.id===$('#ev-id').value); if(!v) return;
  const total=+$('#ev-total').value||0;
  const detalle=$('#ev-detalle').value.trim();
  v.rubro=$('#ev-rubro').value; v.fecha=$('#ev-fecha').value||v.fecha;
  v.cliente=$('#ev-cliente').value.trim(); v.vehiculo=$('#ev-vehiculo').value.trim();
  v.patente=$('#ev-patente').value.trim().toUpperCase(); v.metodo=$('#ev-metodo').value; v.total=total;
  const it=(v.items&&v.items[0])||{cantidad:1,precio:total}; it.nombre=detalle; it.precio=total; it.cantidad=it.cantidad||1;
  v.items=[it];
  save(); closeModal(); render(); toast('✅ Venta actualizada');
}

/* ---- CONTROL DE STOCK ---- */
function viewStock(){
  let list=[...DB.productos];
  if(stockFilter!=='todos') list=list.filter(p=>p.rubro===stockFilter);
  const valorStock = DB.productos.reduce((s,p)=>s+p.costo*p.stock,0);
  const nBajos=DB.productos.filter(p=>p.stock<=p.stockMin).length;
  const nSin=DB.productos.filter(p=>p.stock<=0).length;
  return `
  <div class="page-head">
    <div><h1>Control de Stock</h1><p>Gestioná inventario, precios y disponibilidad de repuestos e insumos</p></div>
    <div class="actions">
      <button class="btn" onclick="exportCSV('stock')">⭳ Exportar</button>
      <button class="btn primary" onclick="openProduct()">＋ Agregar producto</button>
    </div>
  </div>
  ${statsRow([
    {ic:'📦', lbl:'Productos', val:num(DB.productos.length), delta:'+2', up:true, per:'Total'},
    {ic:'💰', lbl:'Valor de inventario', val:money(valorStock), delta:'+5,0%', up:true, per:'A costo'},
    {ic:'⚠️', lbl:'Stock bajo', val:num(nBajos), delta:nBajos?'Revisar':'OK', up:nBajos===0, per:'Por reponer'},
    {ic:'⛔', lbl:'Sin stock', val:num(nSin), delta:nSin?'Urgente':'OK', up:nSin===0, per:'Agotados'},
  ])}
  <div class="panel">
    <div class="panel-tools">
      <div class="mini-search">${iconSearch()}<input id="qStock" placeholder="Buscar por nombre o código"></div>
      ${seg('stockFilter',[['todos','Todos'],['turbo','Turbos'],['lubricentro','Lubricentro']], v=>go('stock',{rubro:v}) )}
    </div>
    <table>
      <thead><tr>
        <th>Producto</th><th>Código</th><th>Rubro</th><th class="right">Costo</th><th class="right">Venta</th><th class="right">Stock</th><th>Estado</th><th></th>
      </tr></thead>
      <tbody id="stockBody">${rowsStock(list)}</tbody>
    </table>
    <div class="table-foot"><span>${list.length} producto(s)</span></div>
  </div>`;
}
function rowsStock(list){
  if(!list.length) return `<tr><td colspan="8"><div class="empty"><div class="big">📦</div>No hay productos.<br><button class="btn primary sm" style="margin-top:12px" onclick="openProduct()">＋ Agregar producto</button></div></td></tr>`;
  return list.map(p=>{const e=estadoStock(p);return `
    <tr>
      <td class="cell-name"><div class="thumb">${p.rubro==='turbo'?'🌀':'🛢️'}</div>
        <div><div class="t">${p.nombre}</div><div class="sub">${p.tipo||''}</div></div></td>
      <td class="muted mono">${p.sku||'—'}</td>
      <td><span class="tag ${p.rubro==='turbo'?'turbo':'lubri'}">${p.rubro==='turbo'?'Turbos':'Lubricentro'}</span></td>
      <td class="right muted mono">${money(p.costo)}</td>
      <td class="right strong mono">${money(p.precio)}</td>
      <td class="right mono">${num(p.stock)} <span class="muted">/ mín ${p.stockMin}</span></td>
      <td><span class="pill ${e.cls}">${e.txt}</span></td>
      <td class="right">
        <button class="rowbtn" onclick="openProduct('${p.id}')">Editar</button>
        <button class="rowbtn del" onclick="delProducto('${p.id}')">✕</button>
      </td>
    </tr>`}).join('');
}

/* ---- LIBRO DIARIO ---- */
function viewDiario(){
  const rubro = diaryFilter;
  const esRep = rubro==='turbo';   // turbos = repuestos usados, no ventas
  const list = ventasFiltro(rubro);
  const now=new Date(), y=now.getFullYear(), m=now.getMonth();
  const rLbl = esRep?'Turbos':'Lubricentro';
  // agrupar por fecha
  const groups={};
  list.forEach(v=>{ (groups[v.fecha]=groups[v.fecha]||[]).push(v); });
  const fechas=Object.keys(groups).sort((a,b)=>b.localeCompare(a));

  const cuerpo = fechas.length ? fechas.map((f)=>`
    <div class="day-group">
      <div class="day-head">
        <span class="d-date">${fmtDay(f)}</span>
        <span class="d-count">· ${groups[f].length} ${esRep?'repuesto(s)':'operación(es)'}</span>
        <span class="d-total">${esRep? groups[f].reduce((s,v)=>s+v.items.reduce((a,i)=>a+(+i.cantidad||0),0),0)+' u.' : money(groups[f].reduce((s,v)=>s+v.total,0))}</span>
      </div>
      <table><tbody>${groups[f].map(v=>`
        <tr>
          <td class="cell-name" style="width:34%"><div class="thumb">${esRep?'🔧':'🛢️'}</div>
            <div><div class="t">${esRep?(v.items[0]?v.items[0].nombre:'—'):(v.cliente||'Consumidor final')}</div><div class="sub">${esRep?(v.cliente&&v.cliente!=='Repuesto usado'?v.cliente:'Repuesto usado'):(v.vehiculo||'—')}</div></div></td>
          ${esRep
            ? `<td class="muted">Cant: ${v.items.map(i=>num(i.cantidad)).join(', ')}</td><td class="muted mono" style="width:120px">${fmtDate(v.fecha)}</td><td class="right"><button class="rowbtn del" onclick="delVenta('${v.id}')">Quitar</button></td>`
            : `<td class="muted">${v.items.map(i=>`${i.cantidad>1?i.cantidad+'× ':''}${i.nombre}`).join(', ')}</td><td class="muted" style="width:120px">${v.metodo||'—'}</td><td class="right strong mono" style="width:130px">${money(v.total)}</td>`}
        </tr>`).join('')}</tbody></table>
    </div>`).join('')
    : `<div class="empty"><div class="big">${esRep?'🔧':'📖'}</div>${esRep?'Todavía no registraste repuestos usados.':'Sin movimientos en el libro diario.'}</div>`;

  const totalUnidades = list.reduce((s,v)=>s+v.items.reduce((a,i)=>a+(+i.cantidad||0),0),0);
  const unidadesMes = list.filter(v=>{const d=new Date(v.fecha+'T00:00:00');return d.getFullYear()===y&&d.getMonth()===m;}).reduce((s,v)=>s+v.items.reduce((a,i)=>a+(+i.cantidad||0),0),0);

  return `
  <div class="page-head">
    <div><h1>${esRep?'Repuestos usados en turbos':'Libro Diario'}</h1>
      <p>${esRep?'Repuestos que se usan para reparar turbos — descuenta del stock (no es una venta)':'Registro cronológico de operaciones por rubro'}</p></div>
    <div class="actions">
      <button class="btn" onclick="exportCSV('ventas')">⭳ Exportar</button>
      ${esRep
        ? `<button class="btn primary" onclick="openRepuesto()">🔧 ＋ Registrar repuesto usado</button>`
        : `<button class="btn primary" onclick="openSale('${rubro}')">＋ Nueva operación</button>`}
    </div>
  </div>
  ${esRep ? statsRow([
    {ic:'🔧', lbl:'Repuestos usados (mes)', val:num(unidadesMes)+' u.', delta:'', up:true, per:MES[m]+' '+y},
    {ic:'📦', lbl:'Registros (mes)', val:num(countPeriodo({rubro,year:y,month:m})), delta:'', up:true, per:MES[m]},
    {ic:'📅', lbl:'Repuestos usados (histórico)', val:num(totalUnidades)+' u.', delta:'', up:true, per:'Total'},
    {ic:'🌀', lbl:'Registros totales', val:num(list.length), delta:'', up:true, per:'Histórico'},
  ]) : statsRow([
    {ic:'💵', lbl:`${rLbl} — mes`, val:money(totalPeriodo({rubro,year:y,month:m})), delta:'+12,5%', up:true, per:MES[m]+' '+y},
    {ic:'🧾', lbl:`N° ventas ${rLbl} (mes)`, val:num(countPeriodo({rubro,year:y,month:m})), delta:'+3', up:true, per:MES[m]},
    {ic:'📅', lbl:`${rLbl} — año`, val:money(totalPeriodo({rubro,year:y})), delta:'+8,2%', up:true, per:'Año '+y},
    {ic:'🧮', lbl:'Total general (mes)', val:money(totalPeriodo({year:y,month:m})), delta:'+9,3%', up:true, per:'Turbos + Lubri'},
  ])}
  <div class="panel-tools" style="background:#fff;border:1px solid var(--line);border-radius:14px;margin-bottom:14px">
    <strong style="font-size:13px">Ver:</strong>
    ${seg('diaryFilter',[['turbo','🔧 Repuestos Turbos'],['lubricentro','🛢️ Ventas Lubricentro']], v=>go('diario',{rubro:v}) )}
    <span style="margin-left:auto" class="muted">${esRep?('Total repuestos: <strong class="mono" style="color:var(--ink)">'+num(totalUnidades)+' u.</strong>'):('Total Lubricentro: <strong class="mono" style="color:var(--ink)">'+money(list.reduce((s,v)=>s+v.total,0))+'</strong>')}</span>
  </div>
  <div class="panel">${cuerpo}</div>`;
}

/* ---- Registrar repuesto usado en un turbo (descuenta stock, no es venta) ---- */
function openRepuesto(){
  $('#modalRoot').innerHTML=`
  <div class="modal" style="max-width:520px">
    <div class="modal-head"><div><h2>🔧 Registrar repuesto usado</h2><p>Se descuenta del stock de turbos. No cuenta como venta.</p></div>
      <button class="x" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="grid2">
        <div class="field"><label>Fecha</label><input type="date" id="rp-fecha" value="${todayISO()}"></div>
        <div class="field"><label>Cantidad usada</label><input type="number" min="0" step="any" id="rp-cant" value="1"></div>
      </div>
      <div class="field"><label>Repuesto de turbo</label>
        <input id="rp-prod" list="turbolist2" placeholder="Buscá por nombre o código…" autocomplete="off">
        <datalist id="turbolist2">${turboProdOptions()}</datalist></div>
      <div class="field"><label>¿Para qué turbo? (opcional)</label><input id="rp-nota" placeholder="Ej: reparación turbo Amarok de Pérez"></div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn primary" onclick="saveRepuesto()">Registrar y descontar</button></div>
  </div>`;
  showModal();
}
function saveRepuesto(){
  const nombre=$('#rp-prod').value.trim();
  const cant=parseFloat(($('#rp-cant').value||'').toString().replace(',','.'))||0;
  if(!nombre){ toast('Elegí un repuesto de la lista.'); return; }
  if(!(cant>0)){ toast('Ingresá la cantidad usada.'); return; }
  const p=DB.productos.find(x=>x.rubro==='turbo' && x.nombre===nombre);
  const fecha=$('#rp-fecha').value||todayISO();
  const nota=$('#rp-nota').value.trim();
  if(p && cant>p.stock && !confirm(`Stock insuficiente (${num(p.stock)} disponibles). ¿Registrar igual?`)) return;
  DB.ventas.push({id:uid(),fecha,rubro:'turbo',tipo:'repuesto',cliente:nota||'Repuesto usado',vehiculo:'',metodo:'—',total:0,items:[{nombre,cantidad:cant,precio:0}]});
  if(p) p.stock=+(p.stock-cant).toFixed(3);
  DB.movimientos.push({id:uid(),fecha,productoId:p?p.id:null,nombre,rubro:'turbo',cantidad:cant,motivo:'Repuesto usado'+(nota?' — '+nota:'')});
  save(); closeModal(); render(); toast(`🔧 ${num(cant)} u. de ${nombre} descontadas del stock`);
}

/* ---- RESUMEN / REPORTES ---- */
function viewResumen(){
  const now=new Date(), y=now.getFullYear(), m=now.getMonth();
  const anioTurbo=totalPeriodo({rubro:'turbo',year:y});
  const anioLubri=totalPeriodo({rubro:'lubricentro',year:y});
  const anioTot=anioTurbo+anioLubri;
  const tPct = anioTot? Math.round(anioTurbo/anioTot*100):0;

  // rentabilidad
  const costoTurbo=costoPeriodo({rubro:'turbo',year:y});
  const costoLubri=costoPeriodo({rubro:'lubricentro',year:y});
  const brutoTurbo=anioTurbo-costoTurbo, brutoLubri=anioLubri-costoLubri, brutoTot=brutoTurbo+brutoLubri;
  const gastosAnio=gastosPeriodo({year:y});
  const netaTot=brutoTot-gastosAnio;
  const sinCosto=(costoTurbo+costoLubri)===0;

  // tabla mensual
  const filas = MES.map((mm,mi)=>{
    const t=totalPeriodo({rubro:'turbo',year:y,month:mi});
    const l=totalPeriodo({rubro:'lubricentro',year:y,month:mi});
    return {mm,mi,t,l,tot:t+l,n:countPeriodo({year:y,month:mi})};
  });

  return `
  <div class="page-head">
    <div><h1>Resumen y Reportes</h1><p>Análisis de ventas por período — Año ${y}</p></div>
    <div class="actions"><button class="btn" onclick="exportCSV('resumen')">⭳ Exportar</button></div>
  </div>
  ${statsRow([
    {ic:'📅', lbl:'Total del año', val:money(anioTot), delta:'+8,2%', up:true, per:y},
    {ic:'📆', lbl:'Total del mes', val:money(totalPeriodo({year:y,month:m})), delta:'+12,5%', up:true, per:MES[m]},
    {ic:'🌀', lbl:'Turbos (año)', val:money(anioTurbo), delta:tPct+'%', up:true, per:'del total'},
    {ic:'🛢️', lbl:'Lubricentro (año)', val:money(anioLubri), delta:(100-tPct)+'%', up:true, per:'del total'},
  ])}
  ${statsRow([
    {ic:'💹', lbl:'Ganancia Bruta (año)', val:money(brutoTot), delta:anioTot?Math.round(brutoTot/anioTot*100)+'%':'', up:true, per:'Ventas − costo'},
    {ic:'🏦', lbl:'Ganancia Neta (año)', val:money(netaTot), delta:netaTot>=0?'Positiva':'Negativa', up:netaTot>=0, per:'− gastos'},
    {ic:'🌀', lbl:'Bruta Turbos (año)', val:money(brutoTurbo), delta:'', up:true, per:'año'},
    {ic:'🛢️', lbl:'Bruta Lubricentro (año)', val:money(brutoLubri), delta:'', up:true, per:'año'},
  ])}
  <div class="panel" style="margin-bottom:16px">
    <div class="panel-tools"><strong>Rentabilidad — ${y}</strong>${sinCosto?'<span class="muted" style="margin-left:auto;font-size:12px">⚠️ Cargá el costo de los productos para ver la ganancia real</span>':''}</div>
    <table>
      <thead><tr><th>Rubro</th><th class="right">Ingresos</th><th class="right">Costo mercadería</th><th class="right">Ganancia Bruta</th><th class="right">Margen</th></tr></thead>
      <tbody>
        <tr><td class="strong">🌀 Turbos</td><td class="right mono">${money(anioTurbo)}</td><td class="right mono">${money(costoTurbo)}</td><td class="right strong mono" style="color:var(--green)">${money(brutoTurbo)}</td><td class="right mono">${anioTurbo?Math.round(brutoTurbo/anioTurbo*100):0}%</td></tr>
        <tr><td class="strong">🛢️ Lubricentro</td><td class="right mono">${money(anioLubri)}</td><td class="right mono">${money(costoLubri)}</td><td class="right strong mono" style="color:var(--green)">${money(brutoLubri)}</td><td class="right mono">${anioLubri?Math.round(brutoLubri/anioLubri*100):0}%</td></tr>
      </tbody>
      <tfoot><tr style="background:#fbfbfa">
        <td class="strong">GANANCIA BRUTA</td><td class="right strong mono">${money(anioTot)}</td><td class="right strong mono">${money(costoTurbo+costoLubri)}</td>
        <td class="right strong mono" style="color:var(--green)">${money(brutoTot)}</td><td class="right mono">${anioTot?Math.round(brutoTot/anioTot*100):0}%</td></tr></tfoot>
    </table>
    <div style="padding:14px 16px;display:flex;flex-wrap:wrap;gap:28px;border-top:1px solid var(--line2)">
      <div><div class="csub">Ganancia Bruta (año)</div><div class="strong mono" style="font-size:18px">${money(brutoTot)}</div></div>
      <div><div class="csub">− Gastos del año</div><div class="strong mono" style="font-size:18px;color:var(--red)">${money(gastosAnio)}</div></div>
      <div><div class="csub">= GANANCIA NETA (año)</div><div class="strong mono" style="font-size:22px;color:${netaTot>=0?'var(--green)':'var(--red)'}">${money(netaTot)}</div></div>
    </div>
  </div>
  <div class="two-col">
    <div class="card">
      <h3>Evolución mensual ${y}</h3><div class="csub">Turbos vs. Lubricentro</div>
      ${barChart(y)}
      <div class="legend"><span><i class="turbo"></i>Turbos</span><span><i class="lubri"></i>Lubricentro</span></div>
    </div>
    <div class="card">
      <h3>Distribución anual</h3><div class="csub">Participación por rubro</div>
      <div class="rowlist" style="margin-top:8px">
        <div class="rl"><div class="rl-ic" style="background:#efeaff;color:#5a48d6">🌀</div>
          <div class="rl-main"><div class="rl-name"><span>Turbos</span><span class="strong">${money(anioTurbo)}</span></div>
          <div class="rl-bar"><i style="width:${tPct}%;background:var(--brand)"></i></div></div></div>
        <div class="rl"><div class="rl-ic" style="background:#fbf1df;color:#a9701c">🛢️</div>
          <div class="rl-main"><div class="rl-name"><span>Lubricentro</span><span class="strong">${money(anioLubri)}</span></div>
          <div class="rl-bar"><i style="width:${100-tPct}%;background:var(--amber)"></i></div></div></div>
      </div>
      <div style="margin-top:18px" class="csub">Ticket promedio: <strong style="color:var(--ink)">${money(anioTot/Math.max(1,countPeriodo({year:y})))}</strong></div>
    </div>
  </div>
  <div class="panel" style="margin-top:16px">
    <div class="panel-tools"><strong>Detalle mensual — ${y}</strong></div>
    <table>
      <thead><tr><th>Mes</th><th class="right">Turbos</th><th class="right">Lubricentro</th><th class="right">N° ventas</th><th class="right">Total</th></tr></thead>
      <tbody>${filas.map(f=>`
        <tr${f.mi===m?' style="background:#faf9ff"':''}>
          <td class="strong">${f.mm} ${f.mi===m?'<span class="muted">(actual)</span>':''}</td>
          <td class="right mono">${money(f.t)}</td>
          <td class="right mono">${money(f.l)}</td>
          <td class="right mono">${num(f.n)}</td>
          <td class="right strong mono">${money(f.tot)}</td>
        </tr>`).join('')}
        <tr style="background:#fbfbfa"><td class="strong">TOTAL ${y}</td>
          <td class="right strong mono">${money(anioTurbo)}</td>
          <td class="right strong mono">${money(anioLubri)}</td>
          <td class="right strong mono">${num(countPeriodo({year:y}))}</td>
          <td class="right strong mono">${money(anioTot)}</td></tr>
      </tbody>
    </table>
  </div>`;
}

/* ---- RECEPCIÓN DE TURBOS ---- */
function daysBetween(aISO,bISO){ if(!aISO||!bISO) return 0; const a=new Date(aISO+'T00:00:00'),b=new Date(bISO+'T00:00:00'); return Math.max(0,Math.round((b-a)/86400000)); }
function diasTaller(r){ const fin=(r.entregado&&r.entrega)?r.entrega:todayISO(); return daysBetween(r.ingreso,fin); }

function viewRecepcion(){
  const now=new Date(), y=now.getFullYear(), m=now.getMonth();
  let list=[...DB.recepciones];
  if(recFilter==='taller') list=list.filter(r=>!r.entregado);
  if(recFilter==='entregado') list=list.filter(r=>r.entregado);
  list.sort((a,b)=> b.ingreso.localeCompare(a.ingreso) || b.id.localeCompare(a.id));

  const enTaller=DB.recepciones.filter(r=>!r.entregado);
  const entregadosMes=DB.recepciones.filter(r=>r.entregado&&r.entrega&&new Date(r.entrega+'T00:00:00').getMonth()===m&&new Date(r.entrega+'T00:00:00').getFullYear()===y).length;
  const pendCobro=DB.recepciones.filter(r=>!r.pagado).reduce((s,r)=>s+(r.presupuestado?r.costoPresupuesto:0),0);
  const promDias=enTaller.length?Math.round(enTaller.reduce((s,r)=>s+diasTaller(r),0)/enTaller.length):0;

  return `
  <div class="page-head">
    <div><h1>Recepción de Turbos</h1><p>Ingreso, seguimiento y entrega de turbos en el taller</p></div>
    <div class="actions">
      <button class="btn" onclick="exportCSV('recepcion')">⭳ Exportar</button>
      <button class="btn primary" onclick="openRecepcion()">＋ Nueva recepción</button>
    </div>
  </div>
  ${statsRow([
    {ic:'🧰', lbl:'Turbos en taller', val:num(enTaller.length), delta:enTaller.length?'En proceso':'OK', up:enTaller.length===0, per:'Sin entregar'},
    {ic:'✅', lbl:'Entregados (mes)', val:num(entregadosMes), delta:'+', up:true, per:MES[m]},
    {ic:'💳', lbl:'Pendiente de cobro', val:money(pendCobro), delta:pendCobro?'Revisar':'OK', up:pendCobro===0, per:'Impagos'},
    {ic:'⏱️', lbl:'Prom. días en taller', val:num(promDias)+' días', delta:'', up:true, per:'En proceso'},
  ])}
  <div class="panel">
    <div class="panel-tools">
      <div class="mini-search">${iconSearch()}<input id="qRec" placeholder="Buscar por cliente, vehículo o teléfono"></div>
      ${seg('recFilter',[['todos','Todos'],['taller','En taller'],['entregado','Entregados']], v=>{recFilter=v;render();})}
    </div>
    <table>
      <thead><tr>
        <th>Cliente / Vehículo</th><th>Ingreso</th><th class="right">Presupuesto</th><th>Repuestos usados</th>
        <th class="right">Días</th><th>Estado</th><th>Pago</th><th>Entrega</th><th></th>
      </tr></thead>
      <tbody id="recBody">${rowsRecepcion(list)}</tbody>
    </table>
    <div class="table-foot"><span>${list.length} recepción(es)</span></div>
  </div>`;
}
function rowsRecepcion(list){
  if(!list.length) return `<tr><td colspan="9"><div class="empty"><div class="big">🧰</div>No hay turbos registrados.<br><button class="btn primary sm" style="margin-top:12px" onclick="openRecepcion()">＋ Nueva recepción</button></div></td></tr>`;
  return list.map(r=>{
    const dias=diasTaller(r);
    const reps=(r.productos||[]).map(p=>`${p.cantidad>1?p.cantidad+'× ':''}${p.nombre}`).join(', ');
    return `
    <tr>
      <td class="cell-name"><div class="thumb">🌀</div>
        <div><div class="t">${r.cliente||'—'}</div><div class="sub">${r.vehiculo||'—'} · ${r.telefono||'s/tel'}</div></div></td>
      <td class="muted mono">${fmtDate(r.ingreso)}</td>
      <td class="right">${r.presupuestado?`<span class="strong mono">${money(r.costoPresupuesto)}</span>`:'<span class="muted">Sin presup.</span>'}</td>
      <td class="muted">${reps||'—'}</td>
      <td class="right mono ${!r.entregado&&dias>7?'':''}"><span class="pill ${r.entregado?'draft':(dias>7?'warn':'ok')}">${dias} d</span></td>
      <td>${r.entregado?'<span class="pill draft">Entregado</span>':'<span class="pill warn">En taller</span>'}</td>
      <td>${r.pagado?`<span class="pill ok">Pagado</span> <span class="muted">${r.metodo||''}</span>`:'<span class="pill off">Impago</span>'}</td>
      <td class="muted mono">${r.entregado&&r.entrega?fmtDate(r.entrega):'—'}</td>
      <td class="right" style="white-space:nowrap">
        ${!r.entregado?`<button class="rowbtn" onclick="entregar('${r.id}')">Entregar</button>`:''}
        <button class="rowbtn" onclick="openRecepcion('${r.id}')">Editar</button>
        <button class="rowbtn del" onclick="delRecepcion('${r.id}')">✕</button>
      </td>
    </tr>`}).join('');
}

/* ---- CLIENTES ---- */
function lubriKey(v){ return (v.patente||'').trim() || v.vehiculo || v.cliente || 'Sin identificar'; }
function turboKey(r){ return (r.cliente||'').trim() || 'Sin nombre'; }
function viewClientes(){
  const esTurbo = clientFilter==='turbo';
  const map={};
  if(esTurbo){
    // Clientes de turbos = de las Recepciones
    DB.recepciones.forEach(r=>{
      const k=turboKey(r);
      map[k]=map[k]||{clave:k,nombre:k,tel:'',veh:new Set(),notas:'',n:0,last:''};
      const g=map[k]; g.n++; if(r.telefono)g.tel=r.telefono; if(r.vehiculo)g.veh.add(r.vehiculo); if(r.notas)g.notas=r.notas;
      const d=(r.entregado&&r.entrega)?r.entrega:r.ingreso; if(d>g.last)g.last=d;
    });
  } else {
    // Clientes de lubricentro = de los Services (no las ventas de mostrador)
    DB.ventas.filter(v=>v.rubro==='lubricentro' && v.tipo==='service').forEach(v=>{
      const k=lubriKey(v);
      map[k]=map[k]||{clave:k,nombre:v.vehiculo||v.cliente||'',patente:v.patente||'',tel:'',km:0,n:0,tot:0,last:''};
      const g=map[k]; g.n++; g.tot+=v.total; if(v.telefono)g.tel=v.telefono; if(v.patente)g.patente=v.patente;
      if((v.kilometros||0)>g.km)g.km=v.kilometros||0;
      if(v.fecha>=g.last){ g.last=v.fecha; if(v.vehiculo)g.nombre=v.vehiculo; }
    });
  }
  const list=Object.values(map).sort((a,b)=>b.last.localeCompare(a.last));

  const head = esTurbo
    ? `<tr><th>Cliente</th><th>Teléfono</th><th>Vehículo (turbo)</th><th>Notas</th><th class="right">Turbos</th><th>Última visita</th></tr>`
    : `<tr><th>Vehículo</th><th>Patente</th><th>Teléfono</th><th class="right">Últimos km</th><th class="right">Services</th><th class="right">Total</th><th>Última visita</th></tr>`;

  const nameCell = c => `<td class="cell-name"><div class="thumb">${esTurbo?'👤':'🚗'}</div>
      <div><a class="linkname" onclick="openClient('${b64(c.clave)}')">${c.nombre||'—'}</a>
      <div class="sub">${c.tel?('📞 '+c.tel):'<span class="muted">sin teléfono</span>'}</div></div></td>`;

  const body = list.length ? list.map(c=> esTurbo
    ? `<tr>${nameCell(c)}
        <td class="mono">${c.tel||'—'}</td>
        <td class="muted">${[...c.veh].join(', ')||'—'}</td>
        <td class="muted">${c.notas||'—'}</td>
        <td class="right mono">${c.n}</td>
        <td class="muted mono">${fmtDate(c.last)}</td></tr>`
    : `<tr>${nameCell(c)}
        <td class="mono">${c.patente||'—'}</td>
        <td class="mono">${c.tel||'—'}</td>
        <td class="right mono">${c.km?num(c.km)+' km':'—'}</td>
        <td class="right mono">${c.n}</td>
        <td class="right strong mono">${money(c.tot)}</td>
        <td class="muted mono">${fmtDate(c.last)}</td></tr>`).join('')
    : `<tr><td colspan="${esTurbo?6:7}"><div class="empty"><div class="big">👥</div>${esTurbo?'Todavía no hay clientes de turbos. Se registran desde <b>Recepción de Turbos</b>.':'Todavía no hay clientes de lubricentro. Se registran al hacer un <b>Nuevo Service</b>.'}</div></td></tr>`;

  return `
  <div class="page-head"><div><h1>Clientes</h1><p>Registro de clientes por sus services (lubricentro) y turbos recibidos</p></div></div>
  <div class="panel">
    <div class="panel-tools">
      <div class="mini-search">${iconSearch()}<input id="qCliente" placeholder="Buscar por nombre, vehículo o patente" oninput="filterTable('#clientesTable',this.value)"></div>
      ${seg('clientFilter',[['turbo','🌀 Turbos'],['lubricentro','🛢️ Lubricentro']], v=>{clientFilter=v;render();})}
    </div>
    <table id="clientesTable"><thead>${head}</thead><tbody>${body}</tbody></table>
    <div class="table-foot"><span>${list.length} ${esTurbo?'cliente(s)':'vehículo(s)'}</span></div>
  </div>`;
}
function filterTable(sel,q){
  const t=(q||'').toLowerCase().trim();
  $$(sel+' tbody tr').forEach(tr=>{ tr.style.display = (!t || tr.textContent.toLowerCase().includes(t)) ? '' : 'none'; });
}

/* ---- Ficha de cliente (turbos = recepciones · lubricentro = services) ---- */
function openClient(enc){
  const key=unb64(enc), esTurbo=clientFilter==='turbo';
  let tel='', patente='', km=0, total=0, last='', nombre=key; const veh=new Set(); let items='', n=0;

  if(esTurbo){
    const recs=DB.recepciones.filter(r=>turboKey(r)===key).sort((a,b)=>b.ingreso.localeCompare(a.ingreso));
    if(!recs.length) return;
    n=recs.length;
    recs.forEach(r=>{ if(r.telefono&&!tel)tel=r.telefono; if(r.vehiculo)veh.add(r.vehiculo); if(r.presupuestado)total+=r.costoPresupuesto; });
    last=(recs[0].entregado&&recs[0].entrega)?recs[0].entrega:recs[0].ingreso;
    items=recs.map(r=>{
      const reps=(r.productos||[]).map(p=>`${p.cantidad>1?p.cantidad+'× ':''}${p.nombre}`).join(', ');
      return `<div class="op"><div class="op-ic">🧰</div><div class="op-main">
        <div class="op-detail">🌀 ${r.vehiculo||'Turbo'}</div>
        ${r.notas?`<div class="op-sub">📝 ${r.notas}</div>`:''}
        ${reps?`<div class="op-sub">Repuestos: ${reps}</div>`:''}
        <div class="op-sub">${r.entregado?'<span class="pill draft">Entregado</span>':'<span class="pill warn">En taller</span>'} ${r.pagado?'<span class="pill ok">Pagado</span>':'<span class="pill off">Impago</span>'}</div>
        <div class="op-meta">Ingreso ${fmtDate(r.ingreso)}${r.entregado&&r.entrega?` · Entrega ${fmtDate(r.entrega)}`:''}</div>
      </div><div class="op-amt mono">${r.presupuestado?money(r.costoPresupuesto):'—'}</div></div>`;
    }).join('');
  } else {
    const svs=DB.ventas.filter(v=>v.rubro==='lubricentro'&&v.tipo==='service'&&lubriKey(v)===key).sort((a,b)=>b.fecha.localeCompare(a.fecha));
    if(!svs.length) return;
    n=svs.length;
    svs.forEach(v=>{ if(v.telefono&&!tel)tel=v.telefono; if(v.vehiculo)veh.add(v.vehiculo); if(v.patente)patente=v.patente; if((v.kilometros||0)>km)km=v.kilometros; total+=v.total; });
    nombre=svs.find(v=>v.vehiculo)?.vehiculo||key; last=svs[0].fecha;
    items=svs.map(v=>{
      const insumos=(v.insumos||[]).map(i=>`${i.cantidad>1?i.cantidad+'× ':''}${i.nombre}`).join(', ');
      return `<div class="op"><div class="op-ic">🛢️</div><div class="op-main">
        <div class="op-detail"><b>Service</b>${v.kilometros?` · ${num(v.kilometros)} km`:''}${v.patente?` · ${v.patente}`:''}</div>
        ${insumos?`<div class="op-sub">Insumos: ${insumos}</div>`:'<div class="op-sub muted">Sin insumos cargados</div>'}
        <div class="op-meta">${fmtDate(v.fecha)} · ${v.metodo||'—'}</div>
      </div><div class="op-amt mono">${money(v.total)}</div></div>`;
    }).join('');
  }

  $('#modalRoot').innerHTML=`
  <div class="modal">
    <div class="modal-head"><div>
      <h2>${nombre}</h2>
      <p>${tel?('📞 '+tel+' · '):''}${veh.size?[...veh].join(', '):''}${patente?(' · Patente '+patente):''}${km?(' · '+num(km)+' km'):''}</p>
    </div><button class="x" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="cli-stats">
        <div><div class="cs-v">${esTurbo?n:money(total)}</div><div class="cs-l">${esTurbo?'Turbos':'Total facturado'}</div></div>
        <div><div class="cs-v">${n}</div><div class="cs-l">${esTurbo?'Recepciones':'Services'}</div></div>
        <div><div class="cs-v">${veh.size||1}</div><div class="cs-l">Vehículo(s)</div></div>
        ${(!esTurbo&&km)?`<div><div class="cs-v">${num(km)}</div><div class="cs-l">Últimos km</div></div>`:''}
      </div>
      <h4 style="margin:18px 0 10px">Historial</h4>
      <div class="op-list">${items||'<p class="muted">Sin operaciones.</p>'}</div>
    </div>
    <div class="modal-foot">
      <button class="btn danger" style="margin-right:auto" onclick="delClient('${enc}')">Eliminar cliente</button>
      <button class="btn" onclick="openClientEdit('${enc}')">✎ Editar</button>
      <button class="btn primary" onclick="closeModal()">Cerrar</button>
    </div>
  </div>`;
  showModal();
}

/* ---- Editar / eliminar cliente ---- */
function clientMatches(key){
  if(clientFilter==='turbo') return {recs:DB.recepciones.filter(r=>turboKey(r)===key), svs:[]};
  return {recs:[], svs:DB.ventas.filter(v=>v.rubro==='lubricentro'&&v.tipo==='service'&&lubriKey(v)===key)};
}
function openClientEdit(enc){
  const key=unb64(enc), esTurbo=clientFilter==='turbo';
  const {recs,svs}=clientMatches(key); const s=(esTurbo?recs[0]:svs[0])||{};
  const nombre = esTurbo?(s.cliente||key):(s.vehiculo||s.cliente||'');
  $('#modalRoot').innerHTML=`
  <div class="modal" style="max-width:480px">
    <div class="modal-head"><div><h2>Editar cliente</h2><p>Se aplica a sus ${esTurbo?recs.length+' turbo(s)':svs.length+' service(s)'}</p></div>
      <button class="x" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <input type="hidden" id="ce-key" value="${enc}">
      <div class="field"><label>${esTurbo?'Nombre del cliente':'Vehículo'}</label><input id="ce-nombre" value="${(nombre||'').replace(/"/g,'&quot;')}"></div>
      <div class="grid2">
        <div class="field"><label>${esTurbo?'Vehículo del turbo':'Patente'}</label><input id="ce-extra" value="${((esTurbo?s.vehiculo:s.patente)||'').replace(/"/g,'&quot;')}"></div>
        <div class="field"><label>Teléfono</label><input id="ce-tel" value="${(s.telefono||'').replace(/"/g,'&quot;')}"></div>
      </div>
      <p class="qty-hint">Los cambios se aplican a todas las operaciones de este cliente.</p>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn primary" onclick="saveClientEdit()">Guardar</button></div>
  </div>`;
  showModal();
}
function saveClientEdit(){
  const enc=$('#ce-key').value, key=unb64(enc), esTurbo=clientFilter==='turbo';
  const nombre=$('#ce-nombre').value.trim(), extra=$('#ce-extra').value.trim(), tel=$('#ce-tel').value.trim();
  const {recs,svs}=clientMatches(key);
  if(esTurbo) recs.forEach(r=>{ r.cliente=nombre; if(extra)r.vehiculo=extra; r.telefono=tel; });
  else svs.forEach(v=>{ if(nombre)v.vehiculo=nombre; v.patente=extra.toUpperCase(); v.telefono=tel; });
  save(); closeModal(); render(); toast('✅ Cliente actualizado');
}
function delClient(enc){
  const key=unb64(enc), esTurbo=clientFilter==='turbo'; const {recs,svs}=clientMatches(key);
  const cnt=esTurbo?recs.length:svs.length;
  if(!confirm(`¿Eliminar este cliente y sus ${cnt} ${esTurbo?'recepción(es) de turbo':'service(s)'}?\nNo se puede deshacer. (No borra las ventas de mostrador.)`)) return;
  if(esTurbo){
    recs.forEach(r=>{ if(r.ventaId) DB.ventas=DB.ventas.filter(v=>v.id!==r.ventaId); });
    const ids=new Set(recs.map(r=>r.id)); DB.recepciones=DB.recepciones.filter(r=>!ids.has(r.id));
  } else {
    svs.forEach(v=>(v.insumos||[]).forEach(it=>{ const p=DB.productos.find(x=>x.rubro==='lubricentro'&&x.nombre===it.nombre); if(p) p.stock=+(p.stock+it.cantidad).toFixed(3); }));
    const ids=new Set(svs.map(v=>v.id)); DB.ventas=DB.ventas.filter(v=>!ids.has(v.id));
  }
  save(); closeModal(); render(); toast('Cliente eliminado');
}

/* ---- PROVEEDORES ---- */
function viewProveedores(){
  const ym=ymNow(), y=new Date().getFullYear(), m=new Date().getMonth();
  const comprasMes=DB.compras.filter(c=>monthKey(c.fecha)===ym);
  const totMes=comprasMes.reduce((s,c)=>s+c.costo,0);
  const pendiente=DB.compras.filter(c=>!c.saldado).reduce((s,c)=>s+c.costo,0);
  const compras=[...DB.compras].sort((a,b)=>b.fecha.localeCompare(a.fecha));
  return `
  <div class="page-head">
    <div><h1>Proveedores</h1><p>Datos de proveedores y compras realizadas</p></div>
    <div class="actions">
      <button class="btn" onclick="openProveedor()">＋ Nuevo proveedor</button>
      <button class="btn primary" onclick="openCompra()">＋ Nueva compra</button>
    </div>
  </div>
  ${statsRow([
    {ic:'🏢', lbl:'Proveedores', val:num(DB.proveedores.length), delta:'', up:true, per:'Registrados'},
    {ic:'🧾', lbl:'Compras del mes', val:money(totMes), delta:'', up:true, per:MES[m]},
    {ic:'⏳', lbl:'Saldo pendiente', val:money(pendiente), delta:pendiente?'A pagar':'OK', up:pendiente===0, per:'Impago'},
    {ic:'📦', lbl:'Compras (mes)', val:num(comprasMes.length), delta:'', up:true, per:MES[m]},
  ])}
  <div class="two-col" style="grid-template-columns:1fr 1.4fr;margin-top:0">
    <div class="panel">
      <div class="panel-tools"><strong>Proveedores</strong></div>
      <table><thead><tr><th>Nombre</th><th>Teléfono</th><th class="right">Pendiente</th><th></th></tr></thead>
      <tbody>${DB.proveedores.length?DB.proveedores.map(p=>{
        const pend=DB.compras.filter(c=>c.proveedorId===p.id&&!c.saldado).reduce((s,c)=>s+c.costo,0);
        return `<tr>
          <td class="cell-name"><div class="thumb">🏢</div><div><div class="t">${p.nombre}</div><div class="sub">${p.rubro||''}</div></div></td>
          <td class="mono muted">${p.telefono||'—'}</td>
          <td class="right mono ${pend?'strong':''}" ${pend?'style="color:var(--red)"':''}>${pend?money(pend):'—'}</td>
          <td class="right" style="white-space:nowrap">
            <button class="rowbtn" onclick="openProveedor('${p.id}')">Editar</button>
            <button class="rowbtn del" onclick="delProveedor('${p.id}')">✕</button></td>
        </tr>`}).join(''):`<tr><td colspan="4"><div class="empty"><div class="big">🏢</div>Sin proveedores.</div></td></tr>`}</tbody></table>
    </div>
    <div class="panel">
      <div class="panel-tools"><strong>Compras a proveedores</strong></div>
      <table><thead><tr><th>Proveedor / Detalle</th><th>Fecha</th><th class="right">Costo</th><th>Estado</th><th></th></tr></thead>
      <tbody>${compras.length?compras.map(c=>`
        <tr>
          <td class="cell-name"><div class="thumb">🧾</div><div><div class="t">${nombreProveedor(c.proveedorId)}</div><div class="sub">${c.detalle||''}</div></div></td>
          <td class="muted mono">${fmtDate(c.fecha)}</td>
          <td class="right strong mono">${money(c.costo)}</td>
          <td>${c.saldado?`<span class="pill ok">Saldado</span> <span class="muted">${c.metodo||''}</span>`:'<span class="pill off">Pendiente</span>'}</td>
          <td class="right" style="white-space:nowrap">
            ${!c.saldado?`<button class="rowbtn" onclick="saldarCompra('${c.id}')">Saldar</button>`:''}
            <button class="rowbtn" onclick="openCompra('${c.id}')">Editar</button>
            <button class="rowbtn del" onclick="delCompra('${c.id}')">✕</button></td>
        </tr>`).join(''):`<tr><td colspan="5"><div class="empty"><div class="big">🧾</div>Sin compras registradas.</div></td></tr>`}</tbody></table>
    </div>
  </div>`;
}

/* ---- GASTOS ---- */
function gastosDelMes(ym){
  // Une gastos manuales + compras (mercadería) del mes
  const manual=DB.gastos.filter(g=>monthKey(g.fecha)===ym).map(g=>({...g,estado:'Pagado',_tipo:'gasto'}));
  const compras=DB.compras.filter(c=>monthKey(c.fecha)===ym).map(c=>({id:c.id,fecha:c.fecha,tipo:'Proveedor / Mercadería',
    detalle:nombreProveedor(c.proveedorId)+(c.detalle?' — '+c.detalle:''),monto:c.costo,metodo:c.metodo,
    estado:c.saldado?'Pagado':'Pendiente',_tipo:'compra'}));
  return [...manual,...compras].sort((a,b)=>b.fecha.localeCompare(a.fecha));
}
function viewGastos(){
  const ym=gastoMonth;
  const list=gastosDelMes(ym);
  const totMes=list.filter(g=>g.estado==='Pagado').reduce((s,g)=>s+g.monto,0);
  const pend=list.filter(g=>g.estado==='Pendiente').reduce((s,g)=>s+g.monto,0);
  // desglose por tipo
  const porTipo={}; list.forEach(g=>{ porTipo[g.tipo]=(porTipo[g.tipo]||0)+g.monto; });
  const tipos=Object.entries(porTipo).sort((a,b)=>b[1]-a[1]);
  const maxT=tipos.length?tipos[0][1]:1;
  return `
  <div class="page-head">
    <div><h1>Gastos</h1><p>Gastos mensuales del taller (incluye compras a proveedores)</p></div>
    <div class="actions">
      <select class="btn" style="font-weight:600" onchange="gastoMonth=this.value;render()">${monthOptions(ym)}</select>
      <button class="btn primary" onclick="openGasto()">＋ Nuevo gasto</button>
    </div>
  </div>
  ${statsRow([
    {ic:'💸', lbl:'Gastos del mes', val:money(totMes), delta:'', up:false, per:fmtMonth(ym)},
    {ic:'⏳', lbl:'Pendiente de pago', val:money(pend), delta:pend?'A pagar':'OK', up:pend===0, per:'Impago'},
    {ic:'🧾', lbl:'N° de gastos', val:num(list.length), delta:'', up:true, per:fmtMonth(ym)},
    {ic:'🏷️', lbl:'Rubro mayor', val:tipos.length?tipos[0][0].split(' ')[0]:'—', delta:tipos.length?money(tipos[0][1]):'', up:false, per:'Del mes'},
  ])}
  <div class="two-col" style="grid-template-columns:1.5fr 1fr;margin-top:0">
    <div class="panel">
      <div class="panel-tools"><strong>Detalle de gastos — ${fmtMonth(ym)}</strong></div>
      <table><thead><tr><th>Concepto</th><th>Tipo</th><th>Fecha</th><th>Pago</th><th class="right">Monto</th><th></th></tr></thead>
      <tbody>${list.length?list.map(g=>`
        <tr>
          <td class="cell-name"><div class="thumb">${g._tipo==='compra'?'📦':'💸'}</div><div class="t">${g.detalle||g.tipo}</div></td>
          <td class="muted">${g.tipo}</td>
          <td class="muted mono">${fmtDate(g.fecha)}</td>
          <td>${g.estado==='Pendiente'?'<span class="pill off">Pendiente</span>':`<span class="muted">${g.metodo||'—'}</span>`}</td>
          <td class="right strong mono">${money(g.monto)}</td>
          <td class="right">${g._tipo==='gasto'?`<button class="rowbtn del" onclick="delGasto('${g.id}')">✕</button>`:`<button class="rowbtn" onclick="go('proveedores')">Ver</button>`}</td>
        </tr>`).join(''):`<tr><td colspan="6"><div class="empty"><div class="big">💸</div>Sin gastos en ${fmtMonth(ym)}.</div></td></tr>`}</tbody></table>
    </div>
    <div class="card">
      <h3>Gastos por tipo</h3><div class="csub">${fmtMonth(ym)}</div>
      <div class="rowlist" style="margin-top:8px">${tipos.length?tipos.map(([t,v],i)=>`
        <div class="rl"><div class="rl-ic" style="background:#f0f0f2;color:#444">${i+1}</div>
          <div class="rl-main"><div class="rl-name"><span>${t}</span><span class="strong">${money(v)}</span></div>
          <div class="rl-bar"><i style="width:${v/maxT*100}%;background:#6b7280"></i></div></div></div>`).join(''):'<p class="muted">Sin datos.</p>'}</div>
    </div>
  </div>`;
}

/* ---- CAJA ---- */
function viewCaja(){
  const ym=cajaMonth;
  const ventasMes=DB.ventas.filter(v=>monthKey(v.fecha)===ym);
  const gastosMes=DB.gastos.filter(g=>monthKey(g.fecha)===ym);
  const comprasMes=DB.compras.filter(c=>monthKey(c.fecha)===ym && c.saldado);
  const ingresoMes=ventasMes.reduce((s,v)=>s+v.total,0);
  const egresoMes=gastosMes.reduce((s,g)=>s+g.monto,0)+comprasMes.reduce((s,c)=>s+c.costo,0);
  const saldoMes=ingresoMes-egresoMes;
  const hoy=todayISO();
  const ingHoy=DB.ventas.filter(v=>v.fecha===hoy).reduce((s,v)=>s+v.total,0);
  const egrHoy=DB.gastos.filter(g=>g.fecha===hoy).reduce((s,g)=>s+g.monto,0)+DB.compras.filter(c=>c.fecha===hoy&&c.saldado).reduce((s,c)=>s+c.costo,0);

  // agrupar por día
  const dias={};
  ventasMes.forEach(v=>{ dias[v.fecha]=dias[v.fecha]||{ing:0,egr:0,nv:0,ng:0}; dias[v.fecha].ing+=v.total; dias[v.fecha].nv++; });
  gastosMes.forEach(g=>{ dias[g.fecha]=dias[g.fecha]||{ing:0,egr:0,nv:0,ng:0}; dias[g.fecha].egr+=g.monto; dias[g.fecha].ng++; });
  comprasMes.forEach(c=>{ dias[c.fecha]=dias[c.fecha]||{ing:0,egr:0,nv:0,ng:0}; dias[c.fecha].egr+=c.costo; dias[c.fecha].ng++; });
  const fechas=Object.keys(dias).sort((a,b)=>b.localeCompare(a));

  return `
  <div class="page-head">
    <div><h1>Caja</h1><p>Movimiento diario de ingresos y egresos</p></div>
    <div class="actions">
      <select class="btn" style="font-weight:600" onchange="cajaMonth=this.value;render()">${monthOptions(ym)}</select>
    </div>
  </div>
  ${statsRow([
    {ic:'📈', lbl:'Ingresos del mes', val:money(ingresoMes), delta:'', up:true, per:fmtMonth(ym)},
    {ic:'📉', lbl:'Egresos del mes', val:money(egresoMes), delta:'', up:false, per:fmtMonth(ym)},
    {ic:'⚖️', lbl:'Saldo del mes', val:money(saldoMes), delta:saldoMes>=0?'Positivo':'Negativo', up:saldoMes>=0, per:fmtMonth(ym)},
    {ic:'📅', lbl:'Saldo de hoy', val:money(ingHoy-egrHoy), delta:money(ingHoy)+' / '+money(egrHoy), up:(ingHoy-egrHoy)>=0, per:'Ingreso/Egreso'},
  ])}
  <div class="panel">
    <div class="panel-tools"><strong>Detalle diario — ${fmtMonth(ym)}</strong></div>
    <table>
      <thead><tr><th>Día</th><th class="right">Ingresos</th><th class="right">Egresos</th><th class="right">Saldo del día</th><th>Movimientos</th></tr></thead>
      <tbody>${fechas.length?fechas.map(f=>{const dd=dias[f];const s=dd.ing-dd.egr;return `
        <tr>
          <td class="strong mono">${fmtDate(f)}</td>
          <td class="right mono" style="color:var(--green)">${dd.ing?money(dd.ing):'—'}</td>
          <td class="right mono" style="color:var(--red)">${dd.egr?money(dd.egr):'—'}</td>
          <td class="right strong mono" style="color:${s>=0?'var(--green)':'var(--red)'}">${money(s)}</td>
          <td class="muted">${dd.nv} venta(s) · ${dd.ng} gasto(s)</td>
        </tr>`}).join(''):`<tr><td colspan="5"><div class="empty"><div class="big">💰</div>Sin movimientos en ${fmtMonth(ym)}.</div></td></tr>`}</tbody>
      <tfoot><tr style="background:#fbfbfa">
        <td class="strong">TOTAL ${fmtMonth(ym)}</td>
        <td class="right strong mono" style="color:var(--green)">${money(ingresoMes)}</td>
        <td class="right strong mono" style="color:var(--red)">${money(egresoMes)}</td>
        <td class="right strong mono" style="color:${saldoMes>=0?'var(--green)':'var(--red)'}">${money(saldoMes)}</td>
        <td></td></tr></tfoot>
    </table>
  </div>`;
}

/* ---- CONFIGURACIÓN ---- */
function viewConfig(){
  const u=CURRENT_USER||{nombre:'—',email:'—',rol:''};
  return `
  <div class="page-head"><div><h1>Configuración</h1><p>Cuenta, usuarios y sesión</p></div></div>
  <div class="two-col" style="grid-template-columns:1fr 1.3fr;margin-top:0">
    <div class="card">
      <h3>Sesión actual</h3><div class="csub">Estás usando el sistema como:</div>
      <div class="rl" style="margin-top:6px">
        <div class="rl-ic" style="background:#eceef1;color:#333;font-size:15px">${(u.nombre||'?').slice(0,1).toUpperCase()}</div>
        <div class="rl-main"><div class="rl-name"><span>${u.nombre}</span></div>
          <div class="op-meta">${u.email||''} · ${u.rol||'Integrante'}</div></div>
      </div>
      <button class="btn danger" style="margin-top:18px;width:100%" onclick="logout()">⎋ Cerrar sesión</button>
      <p class="qty-hint" style="margin-top:14px">🔒 Login seguro con Supabase. La sesión queda guardada en este equipo hasta que cierres sesión.</p>
    </div>
    <div class="panel">
      <div class="panel-tools"><strong>Usuarios del taller</strong>
        <button class="btn sm primary" style="margin-left:auto" onclick="openUsuario()">＋ Nuevo usuario</button></div>
      <table><thead><tr><th>Nombre</th><th>Rol</th><th></th></tr></thead>
      <tbody>${DB.usuarios.length?DB.usuarios.map(x=>`
        <tr>
          <td class="cell-name"><div class="thumb">👤</div><div class="t">${x.nombre||'(sin nombre)'}${CURRENT_USER&&x.id===CURRENT_USER.id?' <span class="muted">(vos)</span>':''}</div></td>
          <td class="muted">${x.rol||'Integrante'}</td>
          <td class="right" style="white-space:nowrap">
            <button class="rowbtn" onclick="openUsuario('${x.id}')">Editar</button>
            ${CURRENT_USER&&x.id===CURRENT_USER.id?'':`<button class="rowbtn del" onclick="delUsuario('${x.id}')">✕</button>`}</td>
        </tr>`).join(''):`<tr><td colspan="3"><div class="empty">Sin usuarios.</div></td></tr>`}</tbody></table>
      <div class="table-foot"><span>Cada integrante entra con su email y contraseña, desde cualquier PC.</span></div>
    </div>
  </div>`;
}
function openUsuario(id){
  const x=id?DB.usuarios.find(u=>u.id===id):null;
  const e=x||{nombre:'',rol:'Integrante'};
  $('#modalRoot').innerHTML=`
  <div class="modal" style="max-width:480px">
    <div class="modal-head"><div><h2>${x?'Editar usuario':'Nuevo usuario'}</h2><p>${x?'Nombre y rol':'Crear acceso al sistema'}</p></div>
      <button class="x" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <input type="hidden" id="u-id" value="${x?x.id:''}">
      <div class="field"><label>Nombre y apellido</label><input id="u-nombre" value="${(e.nombre||'').replace(/"/g,'&quot;')}" placeholder="Ej: Juan Pérez"></div>
      ${x?'':`
      <div class="field"><label>Email (con esto inicia sesión)</label><input id="u-email" type="email" placeholder="juan@taller.com" autocomplete="off"></div>
      <div class="field"><label>Contraseña</label><input id="u-pass" placeholder="mínimo 6 caracteres" autocomplete="new-password"></div>`}
      <div class="field"><label>Rol</label>
        <select id="u-rol">${['Dueño','Encargado','Mecánico','Administrativo','Integrante'].map(r=>`<option ${e.rol===r?'selected':''}>${r}</option>`).join('')}</select></div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn primary" onclick="saveUsuario()">${x?'Guardar':'Crear usuario'}</button></div>
  </div>`;
  showModal();
}
async function saveUsuario(){
  const id=$('#u-id').value, nombre=$('#u-nombre').value.trim(), rol=$('#u-rol').value;
  if(!nombre){ toast('Ingresá el nombre.'); return; }
  if(id){ // editar perfil (nombre + rol)
    const {error}=await supa.from('perfiles').update({nombre,rol}).eq('id',id);
    if(error){ toast('Error al guardar'); return; }
    if(CURRENT_USER&&CURRENT_USER.id===id){ CURRENT_USER.nombre=nombre; CURRENT_USER.rol=rol; }
  } else { // crear acceso nuevo (Supabase Auth)
    const email=$('#u-email').value.trim(), pass=$('#u-pass').value;
    if(!email||pass.length<6){ toast('Email válido y contraseña de 6+ caracteres.'); return; }
    const tmp=window.supabase.createClient(SUPA_URL,SUPA_KEY,{auth:{persistSession:false,storageKey:'sb-tmp-signup',autoRefreshToken:false}});
    const {data,error}=await tmp.auth.signUp({email,password:pass,options:{data:{nombre}}});
    if(error){ toast('No se pudo crear: '+error.message); return; }
    if(data&&data.user){ await supa.from('perfiles').update({nombre,rol}).eq('id',data.user.id); }
  }
  closeModal(); await loadAll(); render(); toast('✅ Usuario guardado');
}
async function delUsuario(id){
  if(CURRENT_USER&&CURRENT_USER.id===id){ toast('No podés eliminar tu propio usuario.'); return; }
  if(!confirm('¿Quitar este usuario del listado?\n(Para bloquear totalmente el acceso, además borralo en Supabase → Authentication.)'))return;
  const {error}=await supa.from('perfiles').delete().eq('id',id);
  if(error){ toast('Error al eliminar'); return; }
  await loadAll(); render(); toast('Usuario quitado');
}

/* ================= Componentes reutilizables ================= */
function iconSearch(){return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`;}
function seg(state, opts, cb){
  window.__segcb = window.__segcb||{}; window.__segcb[state]=cb;
  const cur = {saleFilter,stockFilter,diaryFilter,recFilter,clientFilter}[state];
  return `<div class="seg">${opts.map(([v,l])=>`<button class="${cur===v?'active':''}" onclick="__segcb['${state}']('${v}')">${l}</button>`).join('')}</div>`;
}

/* ================= Wiring de eventos por vista ================= */
function wireView(){
  const qv=$('#qVenta'); if(qv) qv.oninput=()=>{ const t=qv.value.toLowerCase();
    $('#ventasBody').innerHTML=rowsVentas(ventasFiltro(saleFilter).filter(v=>
      (v.cliente||'').toLowerCase().includes(t)||(v.vehiculo||'').toLowerCase().includes(t)||
      v.items.some(i=>i.nombre.toLowerCase().includes(t)))); };
  const qs=$('#qStock'); if(qs) qs.oninput=()=>{ const t=qs.value.toLowerCase();
    let l=DB.productos.filter(p=>stockFilter==='todos'||p.rubro===stockFilter);
    $('#stockBody').innerHTML=rowsStock(l.filter(p=>p.nombre.toLowerCase().includes(t)||(p.sku||'').toLowerCase().includes(t))); };
  const qr=$('#qRec'); if(qr) qr.oninput=()=>{ const t=qr.value.toLowerCase();
    let l=[...DB.recepciones];
    if(recFilter==='taller') l=l.filter(r=>!r.entregado);
    if(recFilter==='entregado') l=l.filter(r=>r.entregado);
    l=l.filter(r=>(r.cliente||'').toLowerCase().includes(t)||(r.vehiculo||'').toLowerCase().includes(t)||(r.telefono||'').toLowerCase().includes(t));
    l.sort((a,b)=>b.ingreso.localeCompare(a.ingreso));
    $('#recBody').innerHTML=rowsRecepcion(l); };
}

/* ================= PUNTO DE VENTA RÁPIDO ================= */
let pos = {id:null, qty:1, price:0};

function posPanel(){
  return `
  <div class="panel">
    <div class="pos-head"><h3>⚡ Punto de Venta Rápido</h3>
      <button class="btn sm" onclick="openService()">🛢️ ＋ Nuevo Service</button></div>
    <div class="pos-body">
      <div class="pos-search">
        <input id="posQ" autocomplete="off" placeholder="Buscar producto para vender (nombre o código)…"
               oninput="posSuggest(this.value)" onfocus="posSuggest(this.value)">
        <div id="posResults" class="pos-results hide"></div>
      </div>
      <div id="posCard">${pos.id?posCardHTML():'<div class="pos-empty">Buscá un producto arriba para vender y ver los precios por medio de pago.</div>'}</div>
    </div>
  </div>`;
}

function posSuggest(v){
  const box=$('#posResults'); if(!box) return;
  const t=(v||'').trim().toLowerCase();
  if(!t){ box.classList.add('hide'); box.innerHTML=''; return; }
  const res=DB.productos.filter(p=>p.nombre.toLowerCase().includes(t)||(p.sku||'').toLowerCase().includes(t)).slice(0,8);
  if(!res.length){ box.innerHTML=`<button disabled style="color:var(--muted)">Sin coincidencias</button>`; box.classList.remove('hide'); return; }
  box.innerHTML=res.map(p=>{const e=estadoStock(p);return `
    <button onclick="posSelect('${p.id}')">
      <span>${p.rubro==='turbo'?'🌀':'🛢️'}</span>
      <span><div class="pr-name">${p.nombre}</div><div class="pr-sub">${p.sku||''} · Stock: ${num(p.stock)} · <span style="color:${e.cls==='ok'?'var(--green)':e.cls==='warn'?'var(--amber)':'var(--red)'}">${e.txt}</span></div></span>
      <span class="pr-price">${money(p.precio)}</span>
    </button>`}).join('');
  box.classList.remove('hide');
}

function posSelect(id){
  const p=DB.productos.find(x=>x.id===id); if(!p) return;
  pos={id, qty:1, price:p.precio};
  $('#posResults').classList.add('hide');
  const q=$('#posQ'); if(q) q.value=p.nombre;
  $('#posCard').innerHTML=posCardHTML();
}

function posCardHTML(){
  const p=DB.productos.find(x=>x.id===pos.id); if(!p) return '';
  const e=estadoStock(p);
  return `
  <div class="pos-card">
    <div class="pc-name">${p.nombre}</div>
    <div class="pc-code">Código: ${p.sku||'—'} · <span class="tag ${p.rubro==='turbo'?'turbo':'lubri'}">${p.rubro==='turbo'?'Turbos':'Lubricentro'}</span></div>
    <div class="pc-stock"><span class="pill ${e.cls}">${e.txt}</span> <span class="muted mono">Disponible: ${num(p.stock)} u.</span></div>
    <div class="pos-qtyrow">
      <div class="qf"><label>Cant:</label><input type="number" min="0" step="any" id="posQty" value="${pos.qty}" oninput="posSetQty(this.value)"></div>
      <div class="qf"><label>Precio c/u ($):</label><input type="number" min="0" step="any" id="posPrice" value="${pos.price}" oninput="posSetPrice(this.value)"></div>
      <span class="qty-hint">Podés poner decimales (ej. 0,5 para medio litro)</span>
    </div>
    <div class="pay-grid">
      ${PAY.map(m=>`
        <div class="pay ${m.cls}">
          <div class="p-lbl">${m.lbl}</div>
          <div class="p-amt" id="amt-${m.key}">${money(round10(pos.qty*pos.price*m.f))}</div>
          <button onclick="vender('${m.key}')">VENDER</button>
        </div>`).join('')}
    </div>
    <div class="pos-extra">
      <span class="muted">¿Se usó en el taller y no se vende?</span>
      <button class="btn" onclick="consumoInterno()">🔧 Uso interno — descontar de stock</button>
    </div>
  </div>`;
}

function posSetQty(v){ pos.qty=Math.max(0,parseFloat((v||'').toString().replace(',','.'))||0); posUpdateAmounts(); }
function posSetPrice(v){ pos.price=Math.max(0,parseFloat((v||'').toString().replace(',','.'))||0); posUpdateAmounts(); }
function posUpdateAmounts(){ PAY.forEach(m=>{ const el=$('#amt-'+m.key); if(el) el.textContent=money(round10(pos.qty*pos.price*m.f)); }); }

function vender(key){
  const p=DB.productos.find(x=>x.id===pos.id); if(!p){ toast('Seleccioná un producto.'); return; }
  const m=PAY.find(x=>x.key===key);
  const qty=pos.qty, price=pos.price;
  if(!(qty>0)){ toast('Ingresá una cantidad válida.'); return; }
  if(qty>p.stock && !confirm(`Stock insuficiente (${num(p.stock)} disponibles). ¿Vender igual y dejar el stock en negativo?`)) return;
  const total=round10(qty*price*m.f);
  DB.ventas.push({id:uid(),fecha:todayISO(),rubro:p.rubro,cliente:'Consumidor final',vehiculo:'',
    metodo:m.name, recargo:m.f-1, items:[{nombre:p.nombre,cantidad:qty,precio:price}], total});
  p.stock=+(p.stock-qty).toFixed(3);
  save(); pos={id:null,qty:1,price:0}; render();
  toast(`✅ Venta ${m.name} — ${money(total)} · descontado ${num(qty)} u.`);
}

function consumoInterno(){
  const p=DB.productos.find(x=>x.id===pos.id); if(!p){ toast('Seleccioná un producto.'); return; }
  const qty=pos.qty;
  if(!(qty>0)){ toast('Ingresá una cantidad válida.'); return; }
  if(!confirm(`Descontar ${num(qty)} u. de "${p.nombre}" por uso interno (sin venta)?`)) return;
  p.stock=+(p.stock-qty).toFixed(3);
  DB.movimientos.push({id:uid(),fecha:todayISO(),productoId:p.id,nombre:p.nombre,rubro:p.rubro,cantidad:qty,motivo:'Uso interno'});
  save(); pos={id:null,qty:1,price:0}; render();
  toast(`🔧 Uso interno — descontadas ${num(qty)} u. de ${p.nombre}`);
}

/* ================= Modal: VENTA ================= */
let cart=[];
function openSale(rubro){
  cart=[{nombre:'',cantidad:1,precio:0}];
  const r = (rubro==='turbo'||rubro==='lubricentro')?rubro:'turbo';
  $('#modalRoot').innerHTML = saleModalHTML(r);
  showModal();
  renderCart();
}
function saleModalHTML(r){
  return `
  <div class="modal">
    <div class="modal-head"><div><h2>Nueva venta</h2><p>Registrá una operación de turbos o lubricentro</p></div>
      <button class="x" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="field"><label>Rubro</label>
        <div class="seg-radio">
          <input type="radio" name="vrubro" id="vr-t" value="turbo" ${r==='turbo'?'checked':''} onchange="onRubroChange()">
          <label for="vr-t" class="${r==='turbo'?'turbo-sel':''}" id="lbl-t">🌀 Turbos</label>
          <input type="radio" name="vrubro" id="vr-l" value="lubricentro" ${r==='lubricentro'?'checked':''} onchange="onRubroChange()">
          <label for="vr-l" class="${r==='lubricentro'?'lubri-sel':''}" id="lbl-l">🛢️ Lubricentro</label>
        </div>
      </div>
      <div class="grid2">
        <div class="field"><label>Cliente</label><input id="v-cliente" placeholder="Nombre del cliente"></div>
        <div class="field"><label>Vehículo</label><input id="v-vehiculo" placeholder="Ej: VW Amarok"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Fecha</label><input type="date" id="v-fecha" value="${todayISO()}"></div>
        <div class="field"><label>Método de pago</label>
          <select id="v-metodo" onchange="updateCartTotal()"><option>Efectivo</option><option>Transferencia</option><option>Débito</option><option>Crédito</option><option>Cuenta corriente</option></select></div>
      </div>
      <div class="items-head"><h4>Ítems (productos y/o servicios)</h4>
        <button class="btn sm" onclick="addCartRow()">＋ Agregar ítem</button></div>
      <div id="cartRows"></div>
      <div class="tot-line"><span class="muted">Subtotal (lista)</span><span id="cartSub" class="mono muted">$0</span></div>
      <div class="tot-line"><span class="muted" id="cartRecLbl">Recargo</span><span id="cartRec" class="mono muted">$0</span></div>
      <div class="tot-line big"><span>Total <span id="cartMetodo" style="font-size:13px;color:var(--muted)"></span></span><span id="cartTotal" class="mono">$0</span></div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn primary" onclick="saveSale()">Guardar venta</button>
    </div>
  </div>`;
}
function onRubroChange(){
  const r=$('input[name=vrubro]:checked').value;
  $('#lbl-t').className = r==='turbo'?'turbo-sel':'';
  $('#lbl-l').className = r==='lubricentro'?'lubri-sel':'';
  renderCart();
}
function prodOptions(rubro){
  const ps=DB.productos.filter(p=>p.rubro===rubro);
  return ps.map(p=>`<option data-precio="${p.precio}" value="${p.nombre}">${p.nombre} — ${money(p.precio)}</option>`).join('');
}
function renderCart(){
  const r=$('input[name=vrubro]:checked')?.value||'turbo';
  $('#cartRows').innerHTML = cart.map((it,i)=>`
    <div class="item-row">
      <input list="prodlist" value="${it.nombre.replace(/"/g,'&quot;')}" placeholder="Producto o servicio" oninput="cartSet(${i},'nombre',this.value);cartAutoPrice(${i},this.value)">
      <input type="number" min="1" value="${it.cantidad}" placeholder="Cant" oninput="cartSet(${i},'cantidad',+this.value)">
      <input type="number" min="0" value="${it.precio}" placeholder="Precio" oninput="cartSet(${i},'precio',+this.value)">
      <button class="rm" onclick="delCartRow(${i})">✕</button>
    </div>`).join('') +
    `<datalist id="prodlist">${prodOptions(r)}</datalist>`;
  updateCartTotal();
}
function cartSet(i,k,v){ cart[i][k]=v; if(k==='cantidad'||k==='precio') updateCartTotal(); }
function cartAutoPrice(i,name){
  const p=DB.productos.find(x=>x.nombre===name);
  if(p){ cart[i].precio=p.precio; const row=$$('#cartRows .item-row')[i]; if(row) row.children[2].value=p.precio; updateCartTotal(); }
}
function addCartRow(){ cart.push({nombre:'',cantidad:1,precio:0}); renderCart(); }
function delCartRow(i){ cart.splice(i,1); if(!cart.length)cart.push({nombre:'',cantidad:1,precio:0}); renderCart(); }
function metodoFactor(m){ if(m==='Débito')return 1.06; if(m==='Crédito')return 1.096; return 1; }
function updateCartTotal(){
  const sub=cart.reduce((s,it)=>s+(it.cantidad||0)*(it.precio||0),0);
  const met=$('#v-metodo')?$('#v-metodo').value:'Efectivo';
  const f=metodoFactor(met); const total=round10(sub*f); const rec=total-sub;
  const set=(id,val)=>{ const e=$('#'+id); if(e)e.textContent=val; };
  set('cartSub',money(sub)); set('cartRec',money(rec));
  set('cartRecLbl', f>1?('Recargo '+met+' ('+(met==='Débito'?'6%':'9,6%')+')'):'Recargo');
  set('cartMetodo', met?('· '+met):''); set('cartTotal',money(total));
}

function saveSale(){
  const r=$('input[name=vrubro]:checked').value;
  const items=cart.filter(it=>it.nombre.trim() && it.precio>=0 && it.cantidad>0)
                  .map(it=>({nombre:it.nombre.trim(),cantidad:+it.cantidad,precio:+it.precio}));
  if(!items.length){ toast('Agregá al menos un ítem con nombre y precio.'); return; }
  const met=$('#v-metodo').value; const f=metodoFactor(met);
  const sub=items.reduce((s,it)=>s+it.cantidad*it.precio,0);
  const total=round10(sub*f);
  const venta={id:uid(),fecha:$('#v-fecha').value||todayISO(),rubro:r,
    cliente:$('#v-cliente').value.trim(),vehiculo:$('#v-vehiculo').value.trim(),
    metodo:met,recargo:f-1,items,total};
  DB.ventas.push(venta);
  // descontar stock si coincide el nombre
  items.forEach(it=>{ const p=DB.productos.find(x=>x.nombre===it.nombre && x.rubro===r); if(p) p.stock=Math.max(0,p.stock-it.cantidad); });
  save(); closeModal(); render(); toast('✅ Venta registrada — '+money(total));
}
function delVenta(id){
  const v=DB.ventas.find(x=>x.id===id); if(!v) return;
  if(!confirm('¿Eliminar esta venta? Se repondrá al stock lo descontado.'))return;
  (v.insumos||[]).forEach(it=>{ const p=DB.productos.find(x=>x.rubro==='lubricentro'&&x.nombre===it.nombre); if(p) p.stock=+(p.stock+it.cantidad).toFixed(3); });
  (v.items||[]).forEach(it=>{ const p=DB.productos.find(x=>x.nombre===it.nombre&&x.rubro===v.rubro); if(p) p.stock=+(p.stock+it.cantidad).toFixed(3); });
  if(v.recepcionId){ const r=DB.recepciones.find(x=>x.id===v.recepcionId); if(r) r.ventaId=null; }
  DB.ventas=DB.ventas.filter(x=>x.id!==id); save(); render(); toast('Venta eliminada');
}

/* ================= Modal: PRODUCTO ================= */
function openProduct(id){
  const p = id ? DB.productos.find(x=>x.id===id) : null;
  $('#modalRoot').innerHTML = productModalHTML(p);
  showModal();
}
function productModalHTML(p){
  const e=p||{nombre:'',sku:'',rubro:'turbo',tipo:'',costo:'',precio:'',stock:'',stockMin:''};
  // margen de ganancia actual (para pre-cargar al editar); si no aplica, 60
  let defGan=60;
  if(p){ const c=+e.costo||0, pr=+e.precio||0; if(c>0&&pr>0){ const g=Math.round((pr/(c*1.21)-1)*100); if(isFinite(g)&&g>=0&&g<=2000) defGan=g; } }
  return `
  <div class="modal" style="max-width:560px">
    <div class="modal-head"><div><h2>${p?'Editar producto':'Agregar producto'}</h2><p>Datos de inventario</p></div>
      <button class="x" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <input type="hidden" id="p-id" value="${p?p.id:''}">
      <div class="field"><label>Nombre del producto</label><input id="p-nombre" value="${(e.nombre||'').replace(/"/g,'&quot;')}" placeholder="Ej: Filtro de aceite"></div>
      <div class="grid2">
        <div class="field"><label>Código / SKU</label><input id="p-sku" value="${e.sku||''}" placeholder="LUB-4001"></div>
        <div class="field"><label>Rubro</label>
          <select id="p-rubro"><option value="turbo" ${e.rubro==='turbo'?'selected':''}>Turbos</option><option value="lubricentro" ${e.rubro==='lubricentro'?'selected':''}>Lubricentro</option></select></div>
      </div>
      <div class="field"><label>Tipo / categoría</label><input id="p-tipo" value="${e.tipo||''}" placeholder="Aceite, Filtro, Repuesto, Turbo nuevo…"></div>
      <div class="grid2">
        <div class="field"><label>Precio de costo</label><input type="number" min="0" step="any" id="p-costo" value="${e.costo}" placeholder="0" oninput="calcVenta()"></div>
        <div class="field"><label>% de ganancia (vos elegís)</label><input type="number" min="0" step="any" id="p-gan" value="${defGan}" placeholder="Ej: 60" oninput="calcVenta()"></div>
      </div>
      <div class="field"><label>Precio de venta (calculado — podés ajustarlo)</label><input type="number" min="0" step="any" id="p-precio" value="${e.precio}" placeholder="0"></div>
      <div id="p-calc" class="qty-hint" style="margin:-8px 0 12px">El <b>IVA 21% se agrega siempre</b>. Poné el costo y tu % de ganancia, y se calcula el precio de venta.</div>
      <div class="grid2">
        <div class="field"><label>Stock actual</label><input type="number" min="0" id="p-stock" value="${e.stock}" placeholder="0"></div>
        <div class="field"><label>Stock mínimo</label><input type="number" min="0" id="p-min" value="${e.stockMin}" placeholder="0"></div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn primary" onclick="saveProduct()">${p?'Guardar cambios':'Agregar producto'}</button>
    </div>
  </div>`;
}
function calcVenta(){
  const costo=parseFloat(($('#p-costo').value||'').toString().replace(',','.'))||0;
  const iva=21;   // IVA fijo, siempre
  const gan=parseFloat(($('#p-gan').value||'').toString().replace(',','.'))||0;
  const conIva=costo*(1+iva/100);
  const venta=round10(conIva*(1+gan/100));
  if(costo>0){ const pv=$('#p-precio'); if(pv) pv.value=venta; }
  const el=$('#p-calc'); if(el) el.innerHTML = costo>0
    ? `Costo ${money(costo)} → +21% IVA = ${money(conIva)} → +${gan}% ganancia = <b style="color:var(--ink)">${money(venta)}</b>`
    : 'El <b>IVA 21% se agrega siempre</b>. Poné el costo y tu % de ganancia, y se calcula el precio de venta.';
}
function saveProduct(){
  const nombre=$('#p-nombre').value.trim();
  if(!nombre){ toast('Ingresá el nombre del producto.'); return; }
  const data={nombre,sku:$('#p-sku').value.trim(),rubro:$('#p-rubro').value,tipo:$('#p-tipo').value.trim(),
    costo:+$('#p-costo').value||0,precio:+$('#p-precio').value||0,stock:+$('#p-stock').value||0,stockMin:+$('#p-min').value||0};
  const id=$('#p-id').value;
  if(id){ const p=DB.productos.find(x=>x.id===id); Object.assign(p,data); }
  else DB.productos.push({id:uid(),...data});
  save(); closeModal(); render(); toast('✅ Producto guardado');
}
function delProducto(id){ if(!confirm('¿Eliminar este producto del inventario?'))return; DB.productos=DB.productos.filter(p=>p.id!==id); save(); render(); toast('Producto eliminado'); }

/* ================= Modal: RECEPCIÓN DE TURBOS ================= */
let recCart=[];
function turboProdOptions(){ return DB.productos.filter(p=>p.rubro==='turbo').map(p=>`<option value="${p.nombre.replace(/"/g,'&quot;')}">${p.nombre} — stock ${num(p.stock)}</option>`).join(''); }
function ajustarStockTurbo(prods,signo){ (prods||[]).forEach(it=>{ const p=DB.productos.find(x=>x.rubro==='turbo'&&x.nombre===it.nombre); if(p) p.stock=+(p.stock+signo*it.cantidad).toFixed(3); }); }

/* Sincroniza una recepción entregada + pagada como venta en el libro diario de turbos */
function syncRecepcionVenta(r){
  const debe = r.entregado && r.pagado && r.presupuestado && r.costoPresupuesto>0;
  if(debe){
    const item={nombre:'Reparación de turbo'+(r.notas?' — '+r.notas:''),cantidad:1,precio:r.costoPresupuesto};
    let v = r.ventaId ? DB.ventas.find(x=>x.id===r.ventaId) : null;
    if(v){ v.fecha=r.entrega||todayISO(); v.cliente=r.cliente; v.vehiculo=r.vehiculo; v.telefono=r.telefono; v.metodo=r.metodo; v.total=r.costoPresupuesto; v.items=[item]; }
    else { v={id:uid(),fecha:r.entrega||todayISO(),rubro:'turbo',cliente:r.cliente,vehiculo:r.vehiculo,telefono:r.telefono,metodo:r.metodo,items:[item],total:r.costoPresupuesto,origen:'recepcion',recepcionId:r.id};
      DB.ventas.push(v); r.ventaId=v.id; }
  } else if(r.ventaId){ DB.ventas=DB.ventas.filter(x=>x.id!==r.ventaId); r.ventaId=null; }
}

function openRecepcion(id){
  const r = id ? DB.recepciones.find(x=>x.id===id) : null;
  recCart = r && r.productos && r.productos.length ? r.productos.map(p=>({...p})) : [];
  $('#modalRoot').innerHTML = recepcionModalHTML(r);
  showModal();
  renderRecRows();
}
function recepcionModalHTML(r){
  const e=r||{ingreso:todayISO(),cliente:'',telefono:'',vehiculo:'',presupuestado:false,costoPresupuesto:'',entregado:false,entrega:'',pagado:false,metodo:'Efectivo',notas:''};
  const dias = r ? diasTaller(r) : 0;
  return `
  <div class="modal">
    <div class="modal-head"><div><h2>${r?'Editar recepción':'Nueva recepción de turbo'}</h2>
      <p>${r?('En taller hace '+dias+' día(s)'):'Ingreso de un turbo al taller'}</p></div>
      <button class="x" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <input type="hidden" id="r-id" value="${r?r.id:''}">
      <div class="grid2">
        <div class="field"><label>Fecha de ingreso</label><input type="date" id="r-ingreso" value="${e.ingreso}"></div>
        <div class="field"><label>Teléfono</label><input id="r-telefono" value="${e.telefono||''}" placeholder="351-5551234"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Cliente</label><input id="r-cliente" value="${(e.cliente||'').replace(/"/g,'&quot;')}" placeholder="Nombre del cliente"></div>
        <div class="field"><label>Vehículo</label><input id="r-vehiculo" value="${(e.vehiculo||'').replace(/"/g,'&quot;')}" placeholder="Ej: Iveco Daily"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>¿Presupuestado?</label>
          <select id="r-presup" onchange="document.getElementById('r-costo').disabled=(this.value!=='si')">
            <option value="no" ${e.presupuestado?'':'selected'}>No</option>
            <option value="si" ${e.presupuestado?'selected':''}>Sí</option></select></div>
        <div class="field"><label>Costo del presupuesto ($)</label><input type="number" min="0" id="r-costo" value="${e.costoPresupuesto}" ${e.presupuestado?'':'disabled'} placeholder="0"></div>
      </div>

      <div class="items-head"><h4>Repuestos de stock (turbos) utilizados</h4>
        <button class="btn sm" onclick="addRecRow()">＋ Agregar repuesto</button></div>
      <div id="recRows"></div>
      <p class="qty-hint" style="margin:4px 0 14px">Al guardar, estos repuestos se descuentan del stock de turbos.</p>

      <div class="grid2">
        <div class="field"><label>¿Entregado?</label>
          <select id="r-entregado" onchange="if(this.value==='si'&&!document.getElementById('r-entrega').value)document.getElementById('r-entrega').value='${todayISO()}'">
            <option value="no" ${e.entregado?'':'selected'}>No (en taller)</option>
            <option value="si" ${e.entregado?'selected':''}>Sí</option></select></div>
        <div class="field"><label>Fecha de entrega</label><input type="date" id="r-entrega" value="${e.entrega||''}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>¿Pagado?</label>
          <select id="r-pagado"><option value="no" ${e.pagado?'':'selected'}>No</option><option value="si" ${e.pagado?'selected':''}>Sí</option></select></div>
        <div class="field"><label>Medio de pago</label>
          <select id="r-metodo">${['Efectivo','Transferencia','Débito','Crédito','Cuenta corriente'].map(x=>`<option ${e.metodo===x?'selected':''}>${x}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Notas / trabajo a realizar</label><textarea id="r-notas" rows="2" placeholder="Detalle del trabajo, observaciones…">${e.notas||''}</textarea></div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn primary" onclick="saveRecepcion()">${r?'Guardar cambios':'Registrar ingreso'}</button>
    </div>
  </div>`;
}
function renderRecRows(){
  const cont=$('#recRows'); if(!cont) return;
  cont.innerHTML = (recCart.length?recCart:[]).map((it,i)=>`
    <div class="item-row" style="grid-template-columns:1fr 90px 34px">
      <input list="turbolist" value="${(it.nombre||'').replace(/"/g,'&quot;')}" placeholder="Repuesto de turbo" oninput="recSet(${i},'nombre',this.value)">
      <input type="number" min="0" step="any" value="${it.cantidad}" placeholder="Cant" oninput="recSet(${i},'cantidad',+this.value)">
      <button class="rm" onclick="delRecRow(${i})">✕</button>
    </div>`).join('') + `<datalist id="turbolist">${turboProdOptions()}</datalist>` +
    (recCart.length?'':'<p class="muted" style="margin:0">Sin repuestos cargados (opcional).</p>');
}
function recSet(i,k,v){ recCart[i][k]=v; }
function addRecRow(){ recCart.push({nombre:'',cantidad:1}); renderRecRows(); }
function delRecRow(i){ recCart.splice(i,1); renderRecRows(); }

function saveRecepcion(){
  const cliente=$('#r-cliente').value.trim();
  if(!cliente){ toast('Ingresá el nombre del cliente.'); return; }
  const nuevos=recCart.filter(it=>(it.nombre||'').trim()&&+it.cantidad>0).map(it=>({nombre:it.nombre.trim(),cantidad:+it.cantidad}));
  const presup=$('#r-presup').value==='si';
  const data={
    ingreso:$('#r-ingreso').value||todayISO(), cliente, telefono:$('#r-telefono').value.trim(),
    vehiculo:$('#r-vehiculo').value.trim(), presupuestado:presup, costoPresupuesto:presup?(+$('#r-costo').value||0):0,
    productos:nuevos, entregado:$('#r-entregado').value==='si', entrega:$('#r-entrega').value||'',
    pagado:$('#r-pagado').value==='si', metodo:$('#r-metodo').value, notas:$('#r-notas').value.trim()
  };
  const id=$('#r-id').value;
  let ref;
  if(id){ const r=DB.recepciones.find(x=>x.id===id); ajustarStockTurbo(r.productos,+1); Object.assign(r,data); ajustarStockTurbo(nuevos,-1); ref=r; }
  else { ref={id:uid(),...data}; DB.recepciones.push(ref); ajustarStockTurbo(nuevos,-1); }
  syncRecepcionVenta(ref);
  save(); closeModal(); render();
  toast(ref.ventaId?'✅ Recepción guardada y registrada en el libro de turbos':'✅ Recepción guardada');
}
function entregar(id){
  const r=DB.recepciones.find(x=>x.id===id); if(!r) return;
  r.entregado=true; if(!r.entrega) r.entrega=todayISO();
  syncRecepcionVenta(r);
  save(); render();
  toast(r.ventaId?'✅ Entregado y registrado en el libro de turbos':'✅ Turbo marcado como entregado');
}
function delRecepcion(id){
  if(!confirm('¿Eliminar esta recepción? Se repondrán al stock los repuestos usados.'))return;
  const r=DB.recepciones.find(x=>x.id===id); if(r){ ajustarStockTurbo(r.productos,+1); if(r.ventaId) DB.ventas=DB.ventas.filter(v=>v.id!==r.ventaId); }
  DB.recepciones=DB.recepciones.filter(x=>x.id!==id); save(); render(); toast('Recepción eliminada');
}

/* ================= Modal: NUEVO SERVICE (lubricentro) ================= */
let svcCart=[];
function lubriLabel(p){ const code=(p.sku&&p.sku!==p.nombre)?p.sku:''; return code?(code+' — '+p.nombre):p.nombre; }
function lubriProdOptions(){ return DB.productos.filter(p=>p.rubro==='lubricentro').map(p=>`<option value="${lubriLabel(p).replace(/"/g,'&quot;')}">${lubriLabel(p)} · stock ${num(p.stock)}</option>`).join(''); }
function resolveLubri(txt){
  txt=(txt||'').trim(); if(!txt) return null;
  const ps=DB.productos.filter(p=>p.rubro==='lubricentro'), t=txt.toLowerCase();
  return ps.find(p=>lubriLabel(p).toLowerCase()===t)
      || ps.find(p=>p.sku && p.sku.toLowerCase()===t)
      || ps.find(p=>p.nombre.toLowerCase()===t)
      || ps.find(p=>p.sku && t.startsWith(p.sku.toLowerCase()))
      || null;
}
function openService(){
  // arranca con insumos típicos de un service
  svcCart=[{nombre:'',cantidad:''},{nombre:'',cantidad:''},{nombre:'',cantidad:''}];
  $('#modalRoot').innerHTML=serviceModalHTML();
  showModal(); renderSvcRows();
}
function serviceModalHTML(){
  return `
  <div class="modal">
    <div class="modal-head"><div><h2>🛢️ Nuevo Service</h2><p>Cambio de aceite / service de lubricentro</p></div>
      <button class="x" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="grid3">
        <div class="field"><label>Fecha</label><input type="date" id="s-fecha" value="${todayISO()}"></div>
        <div class="field"><label>Patente</label><input id="s-patente" placeholder="AB123CD" style="text-transform:uppercase"></div>
        <div class="field"><label>Kilómetros</label><input type="number" min="0" id="s-km" placeholder="Ej: 85000"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Vehículo</label><input id="s-vehiculo" placeholder="Ej: VW Amarok 2018"></div>
        <div class="field"><label>Teléfono</label><input id="s-telefono" placeholder="351-5551234"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Monto cobrado ($)</label><input type="number" min="0" id="s-monto" placeholder="Total del service"></div>
        <div class="field"><label>Medio de pago</label>
          <select id="s-metodo">${['Efectivo','Transferencia','Débito','Crédito','Cuenta corriente'].map(x=>`<option>${x}</option>`).join('')}</select></div>
      </div>

      <div class="items-head"><h4>Insumos utilizados (se descuentan del stock)</h4>
        <button class="btn sm" onclick="addSvcRow()">＋ Agregar insumo</button></div>
      <div id="svcRows"></div>
      <p class="qty-hint" style="margin:4px 0 0">Ej: aceite (poné los litros), filtro de aceite, aire, combustible, habitáculo. Cantidad admite decimales.</p>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn primary" onclick="saveService()">Registrar service</button>
    </div>
  </div>`;
}
function renderSvcRows(){
  const cont=$('#svcRows'); if(!cont) return;
  cont.innerHTML = svcCart.map((it,i)=>`
    <div class="item-row" style="grid-template-columns:1fr 110px 34px">
      <input list="lubrilist" value="${(it.nombre||'').replace(/"/g,'&quot;')}" placeholder="Código o nombre del insumo…" oninput="svcSet(${i},'nombre',this.value)">
      <input type="number" min="0" step="any" value="${it.cantidad}" placeholder="Cant/Litros" oninput="svcSet(${i},'cantidad',this.value)">
      <button class="rm" onclick="delSvcRow(${i})">✕</button>
    </div>`).join('') + `<datalist id="lubrilist">${lubriProdOptions()}</datalist>`;
}
function svcSet(i,k,v){ svcCart[i][k]=v; }
function addSvcRow(){ svcCart.push({nombre:'',cantidad:''}); renderSvcRows(); }
function delSvcRow(i){ svcCart.splice(i,1); if(!svcCart.length)svcCart.push({nombre:'',cantidad:''}); renderSvcRows(); }

function saveService(){
  const monto=+$('#s-monto').value||0;
  const vehiculo=$('#s-vehiculo').value.trim();
  const patente=$('#s-patente').value.trim().toUpperCase();
  if(monto<=0){ toast('Ingresá el monto cobrado.'); return; }
  const insumos=svcCart.filter(it=>(it.nombre||'').trim()&&parseFloat((it.cantidad||'').toString().replace(',','.'))>0)
    .map(it=>{ const p=resolveLubri(it.nombre); return {nombre:p?p.nombre:it.nombre.trim(), sku:p?(p.sku||''):'', cantidad:+parseFloat(it.cantidad.toString().replace(',','.'))}; });
  const venta={id:uid(),fecha:$('#s-fecha').value||todayISO(),rubro:'lubricentro',tipo:'service',
    cliente:(vehiculo||patente||'Consumidor final'),vehiculo,patente,telefono:$('#s-telefono').value.trim(),kilometros:+$('#s-km').value||0,
    metodo:$('#s-metodo').value, items:[{nombre:'Service / cambio de aceite'+(patente?' — '+patente:''),cantidad:1,precio:monto}],
    insumos, total:monto};
  DB.ventas.push(venta);
  insumos.forEach(it=>{ const p=DB.productos.find(x=>x.rubro==='lubricentro'&&x.nombre===it.nombre); if(p) p.stock=+(p.stock-it.cantidad).toFixed(3); });
  save(); closeModal(); render(); toast('✅ Service registrado — '+money(monto));
}

/* ================= Modal: PROVEEDOR ================= */
function openProveedor(id){
  const p=id?DB.proveedores.find(x=>x.id===id):null;
  const e=p||{nombre:'',contacto:'',telefono:'',rubro:'',notas:''};
  $('#modalRoot').innerHTML=`
  <div class="modal" style="max-width:520px">
    <div class="modal-head"><div><h2>${p?'Editar proveedor':'Nuevo proveedor'}</h2><p>Datos de contacto</p></div>
      <button class="x" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <input type="hidden" id="pr-id" value="${p?p.id:''}">
      <div class="field"><label>Nombre / Razón social</label><input id="pr-nombre" value="${(e.nombre||'').replace(/"/g,'&quot;')}" placeholder="Ej: Turbos Import SA"></div>
      <div class="grid2">
        <div class="field"><label>Contacto</label><input id="pr-contacto" value="${(e.contacto||'').replace(/"/g,'&quot;')}" placeholder="Persona / sector"></div>
        <div class="field"><label>Teléfono</label><input id="pr-telefono" value="${e.telefono||''}" placeholder="11-4444-5555"></div>
      </div>
      <div class="field"><label>Rubro / qué provee</label><input id="pr-rubro" value="${(e.rubro||'').replace(/"/g,'&quot;')}" placeholder="Aceites, turbos, filtros…"></div>
      <div class="field"><label>Notas</label><textarea id="pr-notas" rows="2">${e.notas||''}</textarea></div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn primary" onclick="saveProveedor()">${p?'Guardar':'Agregar'}</button></div>
  </div>`;
  showModal();
}
function saveProveedor(){
  const nombre=$('#pr-nombre').value.trim(); if(!nombre){ toast('Ingresá el nombre.'); return; }
  const data={nombre,contacto:$('#pr-contacto').value.trim(),telefono:$('#pr-telefono').value.trim(),rubro:$('#pr-rubro').value.trim(),notas:$('#pr-notas').value.trim()};
  const id=$('#pr-id').value;
  if(id) Object.assign(DB.proveedores.find(x=>x.id===id),data); else DB.proveedores.push({id:uid(),...data});
  save(); closeModal(); render(); toast('✅ Proveedor guardado');
}
function delProveedor(id){
  const tiene=DB.compras.some(c=>c.proveedorId===id);
  if(!confirm('¿Eliminar proveedor?'+(tiene?' (sus compras quedarán sin proveedor asignado)':'')))return;
  DB.proveedores=DB.proveedores.filter(x=>x.id!==id); save(); render(); toast('Proveedor eliminado');
}

/* ================= Modal: COMPRA ================= */
function openCompra(id){
  const c=id?DB.compras.find(x=>x.id===id):null;
  const e=c||{proveedorId:(DB.proveedores[0]||{}).id||'',fecha:todayISO(),detalle:'',costo:'',saldado:false,metodo:'Transferencia'};
  if(!DB.proveedores.length){ toast('Primero cargá un proveedor.'); openProveedor(); return; }
  $('#modalRoot').innerHTML=`
  <div class="modal" style="max-width:540px">
    <div class="modal-head"><div><h2>${c?'Editar compra':'Nueva compra'}</h2><p>Compra a un proveedor</p></div>
      <button class="x" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <input type="hidden" id="c-id" value="${c?c.id:''}">
      <div class="field"><label>Proveedor</label>
        <select id="c-prov">${DB.proveedores.map(p=>`<option value="${p.id}" ${e.proveedorId===p.id?'selected':''}>${p.nombre}</option>`).join('')}</select></div>
      <div class="field"><label>Detalle</label><input id="c-detalle" value="${(e.detalle||'').replace(/"/g,'&quot;')}" placeholder="Ej: 2 tambores de aceite 15W40"></div>
      <div class="grid2">
        <div class="field"><label>Producto que ingresa al stock</label>
          <select id="c-producto"><option value="">— No suma stock —</option>${DB.productos.map(p=>`<option value="${p.id}" ${e.productoId===p.id?'selected':''}>${p.rubro==='turbo'?'🌀':'🛢️'} ${p.nombre} (stock ${num(p.stock)})</option>`).join('')}</select></div>
        <div class="field"><label>Cantidad que ingresa</label><input type="number" min="0" step="any" id="c-cantidad" value="${e.cantidad||''}" placeholder="0"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Fecha</label><input type="date" id="c-fecha" value="${e.fecha}"></div>
        <div class="field"><label>Costo ($)</label><input type="number" min="0" id="c-costo" value="${e.costo}" placeholder="0"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>¿Saldado?</label>
          <select id="c-saldado"><option value="no" ${e.saldado?'':'selected'}>No (pendiente)</option><option value="si" ${e.saldado?'selected':''}>Sí</option></select></div>
        <div class="field"><label>Medio de pago</label>
          <select id="c-metodo">${['Efectivo','Transferencia','Débito','Crédito','Cuenta corriente'].map(x=>`<option ${e.metodo===x?'selected':''}>${x}</option>`).join('')}</select></div>
      </div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn primary" onclick="saveCompra()">${c?'Guardar':'Registrar compra'}</button></div>
  </div>`;
  showModal();
}
function aplicarStockCompra(c,signo){ if(c&&c.productoId&&c.cantidad>0){ const p=DB.productos.find(x=>x.id===c.productoId); if(p) p.stock=+(p.stock+signo*c.cantidad).toFixed(3); } }
function saveCompra(){
  const costo=+$('#c-costo').value||0; if(costo<=0){ toast('Ingresá el costo.'); return; }
  const data={proveedorId:$('#c-prov').value,fecha:$('#c-fecha').value||todayISO(),detalle:$('#c-detalle').value.trim(),
    productoId:$('#c-producto').value||'',cantidad:+$('#c-cantidad').value||0,
    costo,saldado:$('#c-saldado').value==='si',metodo:$('#c-metodo').value};
  const id=$('#c-id').value; let addedTxt='';
  if(id){ const c=DB.compras.find(x=>x.id===id); aplicarStockCompra(c,-1); Object.assign(c,data); aplicarStockCompra(c,+1); }
  else { const nc={id:uid(),...data}; DB.compras.push(nc); aplicarStockCompra(nc,+1); }
  if(data.productoId&&data.cantidad>0){ const p=DB.productos.find(x=>x.id===data.productoId); addedTxt=p?` · +${num(data.cantidad)} u. a "${p.nombre}"`:''; }
  save(); closeModal(); render(); toast('✅ Compra registrada'+addedTxt);
}
function saldarCompra(id){ const c=DB.compras.find(x=>x.id===id); if(!c)return; c.saldado=true; if(!c.metodo)c.metodo='Efectivo'; save(); render(); toast('✅ Compra saldada'); }
function delCompra(id){ const c=DB.compras.find(x=>x.id===id); if(!c)return; if(!confirm('¿Eliminar esta compra? Se descontará del stock lo que había sumado.'))return; aplicarStockCompra(c,-1); DB.compras=DB.compras.filter(x=>x.id!==id); save(); render(); toast('Compra eliminada'); }

/* ================= Modal: GASTO ================= */
function openGasto(id){
  const g=id?DB.gastos.find(x=>x.id===id):null;
  const e=g||{fecha:todayISO(),tipo:'Gastos chicos',detalle:'',monto:'',metodo:'Efectivo'};
  $('#modalRoot').innerHTML=`
  <div class="modal" style="max-width:520px">
    <div class="modal-head"><div><h2>${g?'Editar gasto':'Nuevo gasto'}</h2><p>Gasto del taller</p></div>
      <button class="x" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <input type="hidden" id="g-id" value="${g?g.id:''}">
      <div class="field"><label>Tipo de gasto</label>
        <select id="g-tipo">${GASTO_TIPOS.map(t=>`<option ${e.tipo===t?'selected':''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label>Detalle</label><input id="g-detalle" value="${(e.detalle||'').replace(/"/g,'&quot;')}" placeholder="Ej: Alquiler de junio"></div>
      <div class="grid3">
        <div class="field"><label>Fecha</label><input type="date" id="g-fecha" value="${e.fecha}"></div>
        <div class="field"><label>Monto ($)</label><input type="number" min="0" id="g-monto" value="${e.monto}" placeholder="0"></div>
        <div class="field"><label>Medio de pago</label>
          <select id="g-metodo">${['Efectivo','Transferencia','Débito','Crédito'].map(x=>`<option ${e.metodo===x?'selected':''}>${x}</option>`).join('')}</select></div>
      </div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn primary" onclick="saveGasto()">${g?'Guardar':'Agregar gasto'}</button></div>
  </div>`;
  showModal();
}
function saveGasto(){
  const monto=+$('#g-monto').value||0; if(monto<=0){ toast('Ingresá el monto.'); return; }
  const data={fecha:$('#g-fecha').value||todayISO(),tipo:$('#g-tipo').value,detalle:$('#g-detalle').value.trim(),monto,metodo:$('#g-metodo').value};
  const id=$('#g-id').value;
  if(id) Object.assign(DB.gastos.find(x=>x.id===id),data); else DB.gastos.push({id:uid(),...data});
  save(); closeModal(); render(); toast('✅ Gasto registrado');
}
function delGasto(id){ if(!confirm('¿Eliminar este gasto?'))return; DB.gastos=DB.gastos.filter(x=>x.id!==id); save(); render(); toast('Gasto eliminado'); }

/* ================= Modal helpers ================= */
function showModal(){ $('#modalBack').classList.add('show'); }
function closeModal(){ $('#modalBack').classList.remove('show'); $('#modalRoot').innerHTML=''; }
$('#modalBack')?.addEventListener('click',e=>{ if(e.target.id==='modalBack') closeModal(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeModal(); });
document.addEventListener('click',e=>{ const box=$('#posResults'); if(box && !e.target.closest('.pos-search')) box.classList.add('hide'); });

/* ================= Exportar CSV ================= */
function exportCSV(kind){
  let rows=[], name='export';
  if(kind==='stock'){ name='stock';
    rows=[['Nombre','SKU','Rubro','Tipo','Costo','Precio','Stock','StockMin','Estado']];
    DB.productos.forEach(p=>rows.push([p.nombre,p.sku,p.rubro,p.tipo,p.costo,p.precio,p.stock,p.stockMin,estadoStock(p).txt]));
  } else if(kind==='resumen'){ name='resumen_'+new Date().getFullYear();
    const y=new Date().getFullYear();
    rows=[['Mes','Turbos','Lubricentro','N ventas','Total']];
    MES.forEach((mm,mi)=>rows.push([mm,totalPeriodo({rubro:'turbo',year:y,month:mi}),totalPeriodo({rubro:'lubricentro',year:y,month:mi}),countPeriodo({year:y,month:mi}),totalPeriodo({year:y,month:mi})]));
  } else if(kind==='recepcion'){ name='recepcion_turbos';
    rows=[['Ingreso','Cliente','Telefono','Vehiculo','Presupuestado','Costo','Repuestos','Entregado','Entrega','Dias','Pagado','Metodo','Notas']];
    DB.recepciones.forEach(r=>rows.push([r.ingreso,r.cliente,r.telefono,r.vehiculo,r.presupuestado?'Si':'No',r.costoPresupuesto,(r.productos||[]).map(p=>p.cantidad+'x '+p.nombre).join(' | '),r.entregado?'Si':'No',r.entrega||'',diasTaller(r),r.pagado?'Si':'No',r.metodo||'',r.notas||'']));
  } else { name='ventas';
    rows=[['Fecha','Rubro','Cliente','Vehiculo','Pago','Detalle','Total']];
    ventasFiltro('todos').forEach(v=>rows.push([v.fecha,v.rubro,v.cliente,v.vehiculo,v.metodo,v.items.map(i=>i.cantidad+'x '+i.nombre).join(' | '),v.total]));
  }
  const csv=rows.map(r=>r.map(c=>`"${String(c??'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name+'.csv'; a.click();
  toast('⭳ Archivo exportado');
}

/* ================= Toast ================= */
let toastT;
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('show'),2600); }

/* ================= Autenticación (Supabase Auth) ================= */
let CURRENT_USER=null;

async function initAuth(){
  const { data:{ session } } = await supa.auth.getSession();
  if(session){ await entrar(session); } else { showLogin(); }
}
async function entrar(session){
  CURRENT_USER = { id:session.user.id, email:session.user.email, nombre:session.user.email, rol:'Integrante' };
  showLoading();
  try{ await loadAll(); }
  catch(e){ console.error(e); const er=$('#li-error'); if(er){ er.textContent='No se pudieron cargar los datos. Revisá tu conexión e intentá de nuevo.'; er.classList.remove('hide'); } CURRENT_USER=null; return; }
  const perf = DB.usuarios.find(u=>u.id===CURRENT_USER.id);
  if(perf){ CURRENT_USER.nombre=perf.nombre||CURRENT_USER.email; CURRENT_USER.rol=perf.rol||'Integrante'; }
  showApp();
}
function showLogin(){ $('#loginScreen').classList.remove('hide'); $('.app').classList.add('hide'); const e=$('#li-user'); if(e){ e.value=''; e.focus(); } }
function showLoading(){ const er=$('#li-error'); if(er){ er.textContent='Cargando datos…'; er.classList.remove('hide'); } }
function showApp(){ $('#loginScreen').classList.add('hide'); $('.app').classList.remove('hide'); render(); }

async function doLogin(){
  const email=$('#li-user').value.trim(), pass=$('#li-pass').value;
  const er=$('#li-error');
  if(!email||!pass){ er.textContent='Completá email y contraseña.'; er.classList.remove('hide'); return; }
  er.textContent='Ingresando…'; er.classList.remove('hide');
  const { data, error } = await supa.auth.signInWithPassword({ email, password:pass });
  if(error){ er.textContent='Email o contraseña incorrectos.'; return; }
  $('#li-pass').value=''; er.classList.add('hide');
  await entrar(data.session);
  toast('👋 Bienvenido/a, '+CURRENT_USER.nombre);
}
async function logout(){
  if(!confirm('¿Cerrar sesión?')) return;
  await supa.auth.signOut(); CURRENT_USER=null; DB=emptyDB();
  $('#li-pass').value=''; showLogin();
}
// Enter para ingresar
document.addEventListener('keydown',e=>{ if(e.key==='Enter' && $('#loginScreen') && !$('#loginScreen').classList.contains('hide')) doLogin(); });
// Refrescar datos al volver a la pestaña (para ver cambios de otras PC)
document.addEventListener('visibilitychange',()=>{ if(!document.hidden && CURRENT_USER && !$('.app').classList.contains('hide')){ runQueued(async()=>{ await loadAll(); render(); }); } });
function refrescar(){ if(!CURRENT_USER)return; runQueued(async()=>{ await loadAll(); render(); toast('🔄 Datos actualizados'); }); }

/* ================= Init ================= */
initAuth();
