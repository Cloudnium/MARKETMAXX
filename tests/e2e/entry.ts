import { rpcMut, rpc, consultarOperacion } from "@/lib/data/db";
import * as motor from "@/lib/offline/motor";
import * as auto from "@/lib/offline/auto";
import { obtenerStockVivo, aplicarStockVivo } from "@/lib/data/stockVivo";
import { iniciarConexion } from "@/lib/net/conexion";
import * as idb from "@/lib/offline/idb";
import { bloqueaEscrituras, leerConexion } from "@/lib/net/conexion";

(window as any).Market = { rpcMut, rpc, consultarOperacion, ...motor, ...auto, obtenerStockVivo, aplicarStockVivo, iniciarConexion, idb, bloqueaEscrituras, leerConexion };
