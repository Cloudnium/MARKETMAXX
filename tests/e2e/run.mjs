// E2E de ventas concurrentes y offline: Chromium real (IndexedDB y offline reales) + Postgres real.
// Uso: PGDB=t1 node tests/e2e/run.mjs   (requiere BD con SQL 01-26 y los cajeros de tests/sql/fixtures.sh)
import { build } from "esbuild";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import path from "node:path";
import { fileURLToPath } from "node:url";
import { iniciar, sql } from "./gateway.mjs";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, "../..");
const PUERTO = 5555;
const U = ["00000000-0000-0000-0000-000000000101", "00000000-0000-0000-0000-000000000102", "00000000-0000-0000-0000-000000000103"];
const ADM = "00000000-0000-0000-0000-0000000000aa";
let fallos = 0;
const ok = (n, obtenido, esperado) => {
  const bien = JSON.stringify(obtenido) === JSON.stringify(esperado);
  console.log(`${bien ? "PASS" : "FAIL"}  ${n}${bien ? "" : `  (esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(obtenido)})`}`);
  if (!bien) fallos++;
};
const uuid = () => crypto.randomUUID();

await build({
  entryPoints: [path.join(aqui, "entry.ts")], bundle: true, outfile: path.join(aqui, ".bundle.js"), format: "iife", platform: "browser", target: "es2020",
  alias: { "@": raiz },
  plugins: [{ name: "stub", setup(b) { b.onResolve({ filter: /^@\/lib\/supabase\/client$/ }, () => ({ path: path.join(aqui, "stubClient.ts") })); } }],
  define: { "process.env.NEXT_PUBLIC_SUPABASE_URL": '"http://localhost:5555"', "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '"x"' },
  logLevel: "error",
});
const srv = await iniciar(PUERTO, path.join(aqui, "index.html"), path.join(aqui, ".bundle.js"));
const navegador = await chromium.launch();

const S = (q, uid = ADM) => sql(uid, q);
const SC = await S("select id from sedes where codigo='TC'");
const PID = await S(`select id from productos where sede_id='${SC}' and codigo='779001'`);
const ctl = (o) => fetch(`http://localhost:${PUERTO}/ctl`, { method: "POST", body: JSON.stringify(o) });
const stock = async () => Number(await S(`select stock from stock_sede where producto_id='${PID}' and sede_id='${SC}'`));
const poner = async (n) => { const d = n - (await stock()); if (d !== 0) await S(`select ajustar_stock_producto('${SC}','${PID}','tienda', ${d},'e2e')`); };
const invariantes = async (t) => {
  ok(`${t}: stock = suma de movimientos`, await S("select count(*) from v_control_stock"), "0");
  ok(`${t}: stock nunca negativo`, await S("select count(*) from stock_sede where stock < 0"), "0");
};

/** Un dispositivo = un contexto de navegador (IndexedDB propia). */
async function dispositivo(uid) {
  const ctx = await navegador.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
  await page.goto(`http://localhost:${PUERTO}/?uid=${uid}`);
  await page.evaluate(() => window.Market.iniciarMotor());
  const cajaId = await S(`select caja_id from caja_sesiones where usuario_id='${uid}' and estado='abierta' and sede_id='${SC}'`);
  const cajaNombre = await S(`select nombre from cajas where id='${cajaId}'`);
  return { uid, ctx, page, cajaId, cajaNombre, ev: (fn, arg) => page.evaluate(fn, arg) };
}
const snapshot = async (d) => {
  const precio = Number(await S(`select precio_venta from productos where id='${PID}'`));
  await d.ev(([s, c, n, p, pid]) => window.Market.guardarSnapshot({ sedeId: s, productos: [{ id: pid, codigo: "779001", nombre: "Arroz", activo: true, precio: p, stock: 99 }], cajas: [{ id: c, nombre: n, estado: "abierta" }], metodos: ["Efectivo"], sede: { nombre: "T" }, vendedor: "Cajero" }), [SC, d.cajaId, d.cajaNombre, precio, PID]);
};
const argsVenta = (d, q, extra = {}) => ({ p_sede: SC, p_caja: d.cajaId, p_tipo: "boleta", p_cliente: null, p_metodo_pago: "Efectivo", p_descuento_pct: 0, p_items: [{ producto_id: PID, cantidad: q }], ...extra });
const vender = (d, q = 1) => d.ev((a) => window.Market.venderOffline({ sedeId: a.s, cajaId: a.c, tipo: "boleta", metodo: "Efectivo", descuento: 0, clienteId: null, clienteNombre: null, clienteDocumento: null, items: [{ productoId: a.p, cantidad: a.q }] }).then((v) => ({ ok: true, v })).catch((e) => ({ ok: false, msg: e.message, codigo: e.codigo })), { s: SC, c: d.cajaId, p: PID, q });
const esperarSync = (d, ms = 20000) => d.page.waitForFunction(() => { const e = window.Market.leerEstadoOffline(); return e.pendientes === 0 && !e.sincronizando; }, null, { timeout: ms });
const ventasLocales = (d) => d.ev(() => window.Market.idb.listar("ventas"));
const limpiarReservas = async () => { await S(`update stock_leases_offline set expira = now() - interval '1 minute' where estado='activo'`, null); await S(`select _expirar_leases('${SC}')`); };
const cerrarCajasYAbrir = async () => { for (const uid of U) { const c = await S(`select caja_id from caja_sesiones where usuario_id='${uid}' and estado='abierta'`, uid); if (!c) await S(`select abrir_mi_caja('${SC}',0)`, uid); } };
await cerrarCajasYAbrir();
// estado limpio: reservas de corridas anteriores se devuelven al pool antes de empezar
await S(`update stock_leases_offline set expira = now() - interval '1 minute' where estado='activo'`, null);
await S(`select _expirar_leases('${SC}')`);

try {
  console.log("== E1 tres usuarios, última unidad, online y simultáneo");
  await poner(1);
  const dev = [];
  for (const u of U) dev.push(await dispositivo(u));
  const res = await Promise.all(dev.map((d) => d.ev((a) => window.Market.rpcMut("registrar_venta", a).then(() => "ok", (e) => e.message), argsVenta(d, 1))));
  ok("E1 solo 1 venta pasa", res.filter((r) => r === "ok").length, 1);
  ok("E1 los otros reciben 'Stock insuficiente'", res.filter((r) => /Stock insuficiente/.test(r)).length, 2);
  ok("E1 stock final 0", await stock(), 0);
  await invariantes("E1");

  console.log("== E2 tres equipos offline con reservas separadas (9 unidades → 3 por caja)");
  await poner(9);
  for (const d of dev) { await snapshot(d); await d.ev((a) => window.Market.crearReserva({ sedeId: a.s, cajaId: a.c, items: [{ productoId: a.p, cantidad: 3 }], ttlMin: 60 }), { s: SC, c: d.cajaId, p: PID }); }
  ok("E2 el pool quedó en 0 tras reservar (otras cajas no pueden usarlo)", await stock(), 0);
  const base2 = Number(await S("select count(*) from ventas where notas like '%Venta offline OFF-%'"));
  ok("E2 una caja online sin reserva no puede vender lo reservado", /Stock insuficiente/.test(await dev[0].ev((a) => window.Market.rpcMut("registrar_venta", a).then(() => "ok", (e) => e.message), argsVenta(dev[0], 1))), true);
  for (const d of dev) await d.ctx.setOffline(true);
  await dev[0].page.waitForFunction(() => window.Market.bloqueaEscrituras());
  const por = [[], [], []];
  for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) por[i].push(await vender(dev[i], 1));
  ok("E2 cada equipo vendió sus 3 unidades offline", por.flat().filter((r) => r.ok).length, 9);
  ok("E2 la unidad 4 de un equipo se rechaza (sin sobreventa)", (await vender(dev[0], 1)).codigo, "LEASE_INSUFICIENTE");
  ok("E2 tickets provisionales únicos", new Set(por.flat().map((r) => r.v.provisional)).size, 9);
  const sinReserva = await dispositivo(U[0]); await snapshot(sinReserva); await sinReserva.ctx.setOffline(true);
  ok("E2 sin reserva vigente no se puede vender offline", (await vender(sinReserva, 1)).codigo, "SIN_LEASE");
  await sinReserva.ctx.close();
  ok("E2 nada llegó al servidor mientras estaban offline", Number(await S("select count(*) from ventas where notas like '%Venta offline OFF-%'")) - base2, 0);
  for (const d of dev) await d.ctx.setOffline(false);
  for (const d of dev) await esperarSync(d);
  ok("E2 reconexión: 9 ventas, 1 por request_id", Number(await S("select count(*) from ventas where notas like '%Venta offline OFF-%'")) - base2, 9);
  ok("E2 todas con número REAL", (await Promise.all(dev.map(ventasLocales))).flat().filter((v) => v.estado === "sincronizada" && /^[BFN]\d*/.test(v.numero)).length, 9);
  ok("E2 stock final 0 y sin negativos", await stock(), 0);
  ok("E2 reservas liquidadas en el servidor", await S("select count(*) from stock_leases_offline where estado='activo'"), "0");
  ok("E2 reservas locales eliminadas", (await Promise.all(dev.map((d) => d.ev(() => window.Market.idb.listar("leases"))))).flat().length, 0);
  await invariantes("E2");

  console.log("== E3 reconexión con reserva sobrante: lo no vendido vuelve al stock");
  await poner(10);
  const d0 = dev[0];
  await d0.ev((a) => window.Market.crearReserva({ sedeId: a.s, cajaId: a.c, items: [{ productoId: a.p, cantidad: 4 }], ttlMin: 60 }), { s: SC, c: d0.cajaId, p: PID });
  ok("E3 reservó 4 (pool 6)", await stock(), 6);
  await d0.ctx.setOffline(true); await vender(d0, 1); await d0.ctx.setOffline(false); await esperarSync(d0);
  ok("E3 vendió 1, devolvió 3 → stock 9", await stock(), 9);
  await invariantes("E3");

  console.log("== E4 timeout TRAS commit: la respuesta se pierde, el reintento no duplica");
  await poner(5);
  const antes = Number(await S("select count(*) from ventas"));
  await ctl({ reset: true, dropAfterCommit: 1 });
  const r4 = await dev[1].ev((a) => window.Market.rpcMut("registrar_venta", a).then((x) => ({ ok: true, x }), (e) => ({ ok: false, m: e.message })), argsVenta(dev[1], 1));
  ok("E4 el cliente recibe el resultado igualmente", r4.ok, true);
  ok("E4 solo UNA venta nueva en la BD", Number(await S("select count(*) from ventas")) - antes, 1);
  const llamadas = await (await fetch(`http://localhost:${PUERTO}/llamadas`)).json();
  ok("E4 el reintento usó la MISMA request_id", new Set(llamadas.map((l) => l.req)).size, 1);
  ok("E4 stock 5 → 4", await stock(), 4);
  await invariantes("E4");

  console.log("== E5 el envío offline ya se había procesado (respuesta perdida): al reconectar no se duplica");
  await poner(5);
  const d2 = dev[2];
  await d2.ev((a) => window.Market.crearReserva({ sedeId: a.s, cajaId: a.c, items: [{ productoId: a.p, cantidad: 2 }], ttlMin: 60 }), { s: SC, c: d2.cajaId, p: PID });
  await d2.ctx.setOffline(true);
  const vv = (await vender(d2, 1)).v;
  const ob = (await d2.ev(() => window.Market.idb.listar("outbox")))[0];
  await d2.ctx.setOffline(false);
  await ctl({ reset: true });
  // simulamos que un envío anterior sí llegó al servidor pero el dispositivo nunca lo supo
  await S(`select ejecutar_idempotente('${ob.requestId}'::uuid,'registrar_venta','${JSON.stringify(ob.args).replace(/'/g, "''")}'::jsonb)`, d2.uid);
  await esperarSync(d2);
  ok("E5 1 sola venta por request_id", await S(`select count(*) from ventas where notas like '%${vv.provisional}%'`), "1");
  ok("E5 la venta local quedó sincronizada con número real", (await ventasLocales(d2)).find((v) => v.localId === vv.localId).estado, "sincronizada");
  await invariantes("E5");

  console.log("== E6 reserva vencida: el stock vuelve solo y la venta tardía cae al stock actual");
  await poner(6);
  const d1 = dev[1];
  await d1.ev((a) => window.Market.crearReserva({ sedeId: a.s, cajaId: a.c, items: [{ productoId: a.p, cantidad: 3 }], ttlMin: 60 }), { s: SC, c: d1.cajaId, p: PID });
  await d1.ctx.setOffline(true);
  await vender(d1, 1);
  await S(`update stock_leases_offline set expira = now() - interval '1 minute' where estado='activo'`, null);
  await S(`select _expirar_leases('${SC}')`);
  ok("E6 vencida: el servidor recuperó las 3 unidades", await stock(), 6);
  await d1.ctx.setOffline(false); await esperarSync(d1);
  ok("E6 la venta tardía se aceptó contra el stock actual", await stock(), 5);
  await invariantes("E6");

  console.log("== E7 conflictos: precio cambiado → ajustar; sin stock → anular (nunca se borra)");
  await poner(4);
  const d3 = dev[0];
  await snapshot(d3);
  await d3.ev((a) => window.Market.crearReserva({ sedeId: a.s, cajaId: a.c, items: [{ productoId: a.p, cantidad: 2 }], ttlMin: 60 }), { s: SC, c: d3.cajaId, p: PID });
  await d3.ctx.setOffline(true);
  const vp = (await vender(d3, 1)).v;
  const precio0 = Number(await S(`select precio_venta from productos where id='${PID}'`));
  await S(`update productos set precio_venta = precio_venta + 2 where id='${PID}'`, null);
  await d3.ctx.setOffline(false); await esperarSync(d3);
  let vl = (await ventasLocales(d3)).find((v) => v.localId === vp.localId);
  ok("E7 conflicto de PRECIO, venta conservada", [vl.estado, vl.conflicto.tipo], ["conflicto", "precio"]);
  ok("E7 el servidor no registró nada", await S(`select count(*) from ventas where notas like '%${vp.provisional}%'`), "0");
  await d3.ev((id) => window.Market.reenviarConflicto(id, { aceptarPrecio: true }), vp.localId);
  await esperarSync(d3);
  vl = (await ventasLocales(d3)).find((v) => v.localId === vp.localId);
  ok("E7 ajustada (acepta precio): sincronizada", vl.estado, "sincronizada");
  await S(`update productos set precio_venta = ${precio0} where id='${PID}'`, null);
  // conflicto de stock
  await poner(3);
  await snapshot(d3);
  await d3.ev((a) => window.Market.crearReserva({ sedeId: a.s, cajaId: a.c, items: [{ productoId: a.p, cantidad: 2 }], ttlMin: 60 }), { s: SC, c: d3.cajaId, p: PID });
  await d3.ctx.setOffline(true);
  const vs = (await vender(d3, 2)).v;
  await S(`update stock_leases_offline set expira = now() - interval '1 minute' where estado='activo'`, null);
  await S(`select _expirar_leases('${SC}')`);
  await poner(0); // alguien más vendió todo lo devuelto
  await d3.ctx.setOffline(false); await esperarSync(d3);
  vl = (await ventasLocales(d3)).find((v) => v.localId === vs.localId);
  ok("E7 conflicto de STOCK, venta conservada", [vl.estado, vl.conflicto.tipo], ["conflicto", "stock"]);
  await d3.ev((id) => window.Market.anularConflicto(id), vs.localId);
  vl = (await ventasLocales(d3)).find((v) => v.localId === vs.localId);
  ok("E7 anulada localmente pero NO borrada", vl.estado, "anulada_local");
  ok("E7 el servidor sigue sin esa venta", await S(`select count(*) from ventas where notas like '%${vs.provisional}%'`), "0");
  await invariantes("E7");

  console.log("== E8 dos pestañas del mismo equipo: solo una sincroniza");
  await poner(5);
  const dd = dev[1];
  await snapshot(dd);
  await dd.ev((a) => window.Market.crearReserva({ sedeId: a.s, cajaId: a.c, items: [{ productoId: a.p, cantidad: 2 }], ttlMin: 60 }), { s: SC, c: dd.cajaId, p: PID });
  const pagina2 = await dd.ctx.newPage();
  await pagina2.goto(`http://localhost:${PUERTO}/?uid=${dd.uid}`);
  await pagina2.evaluate(() => window.Market.iniciarMotor());
  await dd.ctx.setOffline(true);
  const v8 = (await vender(dd, 1)).v;
  await ctl({ reset: true, latencia: 600 });
  await dd.ctx.setOffline(false);
  await Promise.all([esperarSync(dd), pagina2.waitForFunction(() => window.Market.leerEstadoOffline().pendientes === 0, null, { timeout: 20000 })]);
  const env = (await (await fetch(`http://localhost:${PUERTO}/llamadas`)).json()).filter((l) => l.fn === "registrar_venta");
  await ctl({ latencia: 0 });
  ok("E8 la venta se envió UNA sola vez", env.length, 1);
  ok("E8 1 venta en la BD", await S(`select count(*) from ventas where notas like '%${v8.provisional}%'`), "1");
  await invariantes("E8");

  console.log("== E9 reserva AUTOMÁTICA (sin botón): se crea sola, se puede vender offline y al cerrar caja el stock vuelve");
  await poner(20);
  const da = dev[2];
  await snapshot(da);
  await da.ev((a) => window.Market.sincronizar());
  const auto1 = await da.ev(([s, c, p]) => window.Market.mantenerReserva({ sedeId: s, cajaId: c, cargarProductos: async () => [{ id: p, stock: 20, activo: true }] }), [SC, da.cajaId, PID]);
  ok("E9 primera vez crea la reserva sola", auto1, "renovada");
  ok("E9 reservó el 25% (5 de 20) del pool", await stock(), 15);
  const auto2 = await da.ev(([s, c, p]) => window.Market.mantenerReserva({ sedeId: s, cajaId: c, cargarProductos: async () => [{ id: p, stock: 15, activo: true }] }), [SC, da.cajaId, PID]);
  ok("E9 si sigue vigente no reserva de nuevo", auto2, "vigente");
  ok("E9 el stock no cambió", await stock(), 15);
  await da.ev(() => window.Market.sincronizar());
  ok("E9 un ciclo de sincronización con internet NO deshace la reserva sin usar", [await stock(), (await da.ev(() => window.Market.idb.listar("leases"))).length], [15, 1]);
  await da.ctx.setOffline(true);
  ok("E9 sin conexión vende contra la reserva automática", (await vender(da, 2)).ok, true);
  await da.ctx.setOffline(false); await esperarSync(da);
  ok("E9 reconecta: se vendieron 2 y lo no usado (3) volvió solo: 15 + 3 = 18", await stock(), 18);
  const re = await da.ev(([s, c, p]) => window.Market.mantenerReserva({ sedeId: s, cajaId: c, cargarProductos: async () => [{ id: p, stock: 18, activo: true }] }), [SC, da.cajaId, PID]);
  ok("E9 se renueva sola tras liquidarse (4 = 25% de 18)", [re, await stock()], ["renovada", 14]);
  await da.ev((c) => window.Market.liberarReservasDeCaja(c), da.cajaId);
  ok("E9 al cerrar la caja lo reservado vuelve al stock", await stock(), 18);
  ok("E9 no quedan reservas locales", (await da.ev(() => window.Market.idb.listar("leases"))).length, 0);
  await invariantes("E9");

  await limpiarReservas();
  console.log("== E10 el wifi se corta A MITAD de la venta (el servidor sí la registró): no se duplica ni se pierde stock");
  await poner(10);
  const dA = dev[0];
  await snapshot(dA);
  await dA.ev((a) => window.Market.crearReserva({ sedeId: a.s, cajaId: a.c, items: [{ productoId: a.p, cantidad: 2 }], ttlMin: 60 }), { s: SC, c: dA.cajaId, p: PID });
  const ventas0 = Number(await S("select count(*) from ventas"));
  await ctl({ reset: true, latencia: 1500, dropAfterCommit: 1 }); // el servidor confirma pero la respuesta nunca llega
  const enVuelo = dA.ev((a) => window.Market.registrarVentaSegura({ sedeId: a.s, cajaId: a.c, tipo: "boleta", metodo: "Efectivo", descuento: 0, clienteId: null, clienteNombre: null, clienteDocumento: null, items: [{ productoId: a.p, cantidad: 1 }] }).then((r) => ({ modo: r.modo, motivo: r.motivo })), { s: SC, c: dA.cajaId, p: PID });
  await new Promise((r) => setTimeout(r, 400));
  await dA.ctx.setOffline(true); // se apaga el wifi con la petición en el aire
  const r10 = await enVuelo;
  ok("E10 el cajero NO recibe un error: la venta queda guardada", r10.modo, "guardada");
  await ctl({ latencia: 0 });
  for (let i = 0; i < 40 && Number(await S("select count(*) from ventas")) === ventas0; i++) await new Promise((r) => setTimeout(r, 250));
  ok("E10 (el servidor sí la había registrado aunque el equipo no se enteró)", Number(await S("select count(*) from ventas")) - ventas0, 1);
  await dA.ctx.setOffline(false);
  await esperarSync(dA);
  ok("E10 al reconectar sigue habiendo UNA sola venta", Number(await S("select count(*) from ventas")) - ventas0, 1);
  const ll10 = (await (await fetch(`http://localhost:${PUERTO}/llamadas`)).json()).filter((l) => l.fn === "registrar_venta");
  ok("E10 el reenvío usó la MISMA request_id (el servidor respondió 'repetida')", [ll10.length, new Set(ll10.map((l) => l.req)).size], [2, 1]);
  await dA.ev(() => window.Market.sincronizar());
  ok("E10 stock: 10 - 1 vendida = 9 (nada se perdió ni se descontó dos veces)", await stock(), 9);
  ok("E10 la venta local quedó sincronizada con número real", (await ventasLocales(dA)).filter((v) => v.estado === "sincronizada").length >= 1, true);
  await invariantes("E10");

  await limpiarReservas();
  console.log("== E11 venta ONLINE consume primero la reserva de MI caja");
  await poner(10);
  await esperarSync(dA);
  await dA.ev((a) => window.Market.crearReserva({ sedeId: a.s, cajaId: a.c, items: [{ productoId: a.p, cantidad: 3 }], ttlMin: 60 }), { s: SC, c: dA.cajaId, p: PID });
  const r11 = await dA.ev((a) => window.Market.registrarVentaSegura({ sedeId: a.s, cajaId: a.c, tipo: "boleta", metodo: "Efectivo", descuento: 0, clienteId: null, clienteNombre: null, clienteDocumento: null, items: [{ productoId: a.p, cantidad: 5 }] }).then((r) => r.modo), { s: SC, c: dA.cajaId, p: PID });
  ok("E11 vendió 5 (3 de mi reserva + 2 del stock general)", [r11, await stock()], ["enviada", 5]);
  const l11 = (await dA.ev(() => window.Market.idb.listar("leases")))[0];
  ok("E11 la reserva local quedó marcada como usada (3 de 3)", Object.values(l11.items)[0].usado, 3);
  await dA.ev(() => window.Market.reconciliarReservas());
  ok("E11 reconciliar con el servidor no cambia nada", Object.values((await dA.ev(() => window.Market.idb.listar("leases")))[0].items)[0].usado, 3);
  await invariantes("E11");

  console.log("== E12 reserva huérfana: se creó en el servidor pero la respuesta se perdió → vuelve sola al stock");
  await poner(10);
  const dB = dev[1];
  const leasesActivos = async () => Number(await S(`select coalesce(sum(cantidad-usada-devuelta),0) from stock_leases_offline where estado='activo' and sede_id='${SC}'`));
  await limpiarReservas();
  await poner(10);
  const base12 = await stock();
  await ctl({ reset: true, latencia: 1500, dropAfterCommit: 1 });
  const crea12 = dB.ev((a) => window.Market.crearReserva({ sedeId: a.s, cajaId: a.c, items: [{ productoId: a.p, cantidad: 4 }], ttlMin: 60 }).then(() => "ok", (e) => e.message), { s: SC, c: dB.cajaId, p: PID });
  for (let i = 0; i < 60 && !(await (await fetch(`http://localhost:${PUERTO}/llamadas`)).json()).some((l) => l.fn === "crear_lease_offline"); i++) await new Promise((r) => setTimeout(r, 50));
  await dB.ctx.setOffline(true); // el pedido ya está en el servidor; se corta el wifi antes de recibir la respuesta
  const e12 = await crea12;
  await ctl({ latencia: 0 });
  for (let i = 0; i < 40 && base12 - (await stock()) !== 4; i++) await new Promise((r) => setTimeout(r, 250));
  ok("E12 el equipo NO recibió la reserva (la creación quedó incierta)", e12 !== "ok", true);
  ok("E12 pero el servidor sí la creó: el stock bajó 4", base12 - (await stock()), 4);
  await dB.ctx.setOffline(false);
  await dB.ev(() => { window.Market.config.edadHuerfanaMs = 0; });
  await dB.ev(() => window.Market.reconciliarReservas());
  ok("E12 al reconciliar, la reserva huérfana volvió al stock", await stock(), base12);
  await invariantes("E12");

  await limpiarReservas();
  console.log("== E13 stock en tiempo real: lo que vende o reserva un cajero lo ve el otro");
  await poner(10);
  await dA.ev((a) => window.Market.crearReserva({ sedeId: a.s, cajaId: a.c, items: [{ productoId: a.p, cantidad: 2 }], ttlMin: 60 }), { s: SC, c: dA.cajaId, p: PID });
  const ver = (d) => d.ev(async (a) => { const v = await window.Market.obtenerStockVivo(a.s); const p = window.Market.aplicarStockVivo([{ id: a.p, stock: 0, activo: true }], v)[0]; return [p.stock, p.reservadoOtros]; }, { s: SC, p: PID });
  ok("E13 el otro cajero ve 8 vendibles y 2 apartadas en otra caja", await ver(dB), [8, 2]);
  ok("E13 el dueño de la reserva ve 10 vendibles (8 + sus 2)", await ver(dA), [10, 0]);
  await dA.ev((a) => window.Market.registrarVentaSegura({ sedeId: a.s, cajaId: a.c, tipo: "boleta", metodo: "Efectivo", descuento: 0, clienteId: null, clienteNombre: null, clienteDocumento: null, items: [{ productoId: a.p, cantidad: 3 }] }), { s: SC, c: dA.cajaId, p: PID });
  ok("E13 tras vender 3, el otro cajero ya ve 7 y nada apartado", await ver(dB), [7, 0]);
  await invariantes("E13");

  console.log("== E14 el indicador detecta la caída y la recuperación en pocos segundos (sin evento del navegador)");
  await dB.ev(() => window.Market.iniciarConexion());
  await ctl({ reset: true });
  const t0 = Date.now();
  await ctl({ health: false });
  await dB.page.waitForFunction(() => window.Market.leerConexion() !== "online", null, { timeout: 15000, polling: 100 });
  const caida = Date.now() - t0;
  console.log(`   detectó la caída en ${(caida / 1000).toFixed(1)} s`);
  ok("E14 caída detectada en menos de 9 s", caida < 9000, true);
  const t1 = Date.now();
  await ctl({ health: true });
  await dB.page.waitForFunction(() => window.Market.leerConexion() === "online", null, { timeout: 15000, polling: 100 });
  const vuelta = Date.now() - t1;
  console.log(`   detectó la recuperación en ${(vuelta / 1000).toFixed(1)} s`);
  ok("E14 recuperación detectada en menos de 6 s", vuelta < 6000, true);
} finally {
  await navegador.close();
  srv.close();
}
console.log(`\n== Resultado E2E: ${fallos} fallos`);
process.exit(fallos ? 1 : 0);
