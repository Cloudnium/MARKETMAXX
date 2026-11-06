// Gateway local: expone las funciones de Postgres como /rpc/<fn> (igual que PostgREST) para el E2E.
// Cada petición ejecuta SQL real en la BD de pruebas con auth.uid() = cabecera x-uid.
import http from "node:http";
import { execFile } from "node:child_process";
import fs from "node:fs";

const PG = ["-h", process.env.PGHOST ?? "/tmp/pgt", "-p", process.env.PGPORT ?? "5444", "-U", process.env.PGUSER ?? "pgt", "-X", "-q", "-At", "-v", "VERBOSITY=verbose", process.env.PGDB ?? "t1"];

export function sql(uid, q) {
  return new Promise((ok, mal) => {
    execFile("psql", [...PG, "-v", "ON_ERROR_STOP=1", "-c", q], { env: { ...process.env, PGOPTIONS: uid ? `-c request.uid=${uid}` : "" }, maxBuffer: 50e6 }, (err, out, errout) => {
      if (err) {
        const m = /ERROR:\s+(\w{5}):\s+([^\n]*)/.exec(errout) ?? [];
        return mal({ code: m[1] ?? "XX000", message: (m[2] ?? errout).trim() });
      }
      ok(out.trim());
    });
  });
}

const q = (s) => `$q$${String(s)}$q$`;
const estado = { dropAfterCommit: 0, llamadas: [], latencia: 0, health: true };

export function iniciar(puerto, htmlPath, bundlePath) {
  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
    if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
    if (url.pathname === "/") return res.writeHead(200, { "content-type": "text/html" }).end(fs.readFileSync(htmlPath));
    if (url.pathname === "/bundle.js") return res.writeHead(200, { "content-type": "text/javascript" }).end(fs.readFileSync(bundlePath));
    if (url.pathname === "/auth/v1/health") return estado.health ? res.writeHead(200, cors).end("{}") : req.socket.destroy();
    let body = "";
    for await (const c of req) body += c;
    const json = body ? JSON.parse(body) : {};
    const send = (code, obj) => res.writeHead(code, { "content-type": "application/json", ...cors }).end(JSON.stringify(obj));

    if (url.pathname === "/ctl") { if (json.reset) { estado.llamadas = []; estado.dropAfterCommit = 0; estado.health = true; estado.latencia = 0; } Object.assign(estado, { ...json, reset: undefined }); return send(200, estado); }
    if (url.pathname === "/llamadas") return send(200, estado.llamadas);
    if (url.pathname === "/sql") {
      try { return send(200, { out: await sql(json.uid ?? null, json.q) }); } catch (e) { return send(400, e); }
    }
    const m = /^\/rpc\/(\w+)$/.exec(url.pathname);
    if (!m) return send(404, { message: "no existe" });
    const uid = req.headers["x-uid"];
    let consulta;
    if (m[1] === "ejecutar_idempotente")
      consulta = `select public.ejecutar_idempotente(${q(json.p_request_id)}::uuid, ${q(json.p_fn)}, ${q(JSON.stringify(json.p_args ?? {}))}::jsonb)::text`;
    else if (m[1] === "consultar_operacion") consulta = `select public.consultar_operacion(${q(json.p_request_id)}::uuid)::text`;
    else if (m[1] === "mis_leases_offline") consulta = `select public.mis_leases_offline()::text`;
    else if (m[1] === "stock_sede_vivo") consulta = `select public.stock_sede_vivo(${q(json.p_sede)}::uuid)::text`;
    else return send(404, { message: `rpc ${m[1]} no disponible en el gateway de pruebas` });

    if (m[1] === "ejecutar_idempotente") estado.llamadas.push({ uid, req: json.p_request_id, fn: json.p_fn });
    if (estado.latencia) await new Promise((r) => setTimeout(r, estado.latencia));
    try {
      const out = await sql(uid, consulta);
      if (m[1] === "ejecutar_idempotente" && estado.dropAfterCommit > 0) {
        estado.dropAfterCommit--; // la BD YA confirmó, pero la respuesta nunca llega (timeout tras commit)
        // respuesta cortada a medias: el navegador no la reintenta solo (como un corte real de wifi)
        res.writeHead(200, { "content-type": "application/json", "content-length": 5000, ...cors });
        res.write("{");
        return setTimeout(() => req.socket.destroy(), 20);
      }
      return send(200, JSON.parse(out));
    } catch (e) {
      const http = e.code === "40P01" ? 500 : e.code === "42501" ? 403 : 400;
      return send(http, e);
    }
  });
  return new Promise((ok) => srv.listen(puerto, () => ok(srv)));
}
