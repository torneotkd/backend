import { v4 as uuidv4 } from 'uuid';
import { createConnection as dbConnect } from 'mysql2/promise';
import { connectAsync as mqttConnectAsync } from 'mqtt';

//import config from "./Config.js"
import config from "./Config (Secret).js";
import Utils from './Utils.js';
Utils.logEnabled = config.debug;

let db;
let mqttClient;

Utils.logInfo("Iniciando Store App");
try {
    await app();
    Utils.logInfo("Dentro del loop de eventos de Store App");
    Utils.logInfo("*** Si aplicacion finaliza debe ser reiniciada a la brevedad ***");
}
catch (err) {
    Utils.logError(`${err.message}`);
    Utils.logError("*** Reiniciar la aplicacion a la brevedad ***");
    process.exit(1);
}

// -------------------------
async function app() {
    // nos conectamos a la base de datos
    try {
        Utils.logInfo(`Conectando a la Base de Datos en ${config.db.database}:${config.db.port}`);
        db = await dbConnect({
            host: config.db.host,
            port: config.db.port,
            database: config.db.database,
            user: config.db.user,
            password: config.db.password
        });
        Utils.logInfo("Conectado a la Base de Datos");
    } catch (err) {
        throw new Error(`Error al conectar a la Base de Datos: ${err.message}`);
    }

    // nos conectamos al servidor mqtt
    try {
        const mqttClientId = 'STORE-APP-' + uuidv4();
        Utils.logInfo(`Conectando al Broker en ${config.mqtt.url}`);
        mqttClient = await mqttConnectAsync(config.mqtt.url, {
            clientId: mqttClientId,
            username: config.mqtt.username,
            password: config.mqtt.password,
            clean: true,
            connectTimeout: 4000,
            reconnectPeriod: 1000,
            ca: config.mqtt.ca,
            rejectUnauthorized: true
        });
        Utils.logInfo('Conectado al Broker');
    }
    catch (err) {
        await db.end();
        throw new Error(`Error al conectar con el Broker: ${err.message}`);
    }

    // algunos callback
    mqttClient.on('connect', () => {
        Utils.logInfo('Conectado al broker MQTT...');
    });

    mqttClient.on('reconnect', () => {
        Utils.logInfo('Reconectando al broker MQTT...');
    });

    mqttClient.on('close', () => {
        Utils.logInfo('Conexion cerrada con el broker MQTT...');
    });

    mqttClient.on('error', (err) => {
        Utils.logInfo(`Error con el broker MQTT:${err.message}`);
    });

    mqttClient.on('offline', () => {
        Utils.logInfo('Conexion offline con el broker MQTT...');
    });

    // aqui recibimos los mensajes desde los nodos
    mqttClient.on('message', (topic, message) => {
        // liberamos rapidamente este callback
        setImmediate(() => {
            processMessages(topic, message);
        });
    });

    // nos suscribimos a todos los mensajes de los nodos sensores
    mqttClient.subscribe(config.mqtt.topic);
}

// -------------------------
async function processMessages(topic, message) {
    // preparamos el payload
    let strMessage = message.toString();
    let payload;
    try {
        payload = JSON.parse(strMessage);
    } catch (err) {
        Utils.logError("Mensaje recibido desde el broker MQTT no es valido:");
        Utils.logError(`    ${message}`);
        return;
    }

    // intentamos almacenarlo
    await doStore(topic, payload);
}

// -------------------------
async function doStore(topic, payload) {
    // debe venir el id del nodo
    const nodo_id = payload.nodo_id;
    if (nodo_id == undefined) {
        Utils.logError("NODO_ID no viene en el mensaje");
        return;
    }

    // el topico tiene una regla de formacion basada en el id del nodo
    const topic_ = "SmartBee/nodes/" + nodo_id + "/data";
    if (topic != topic_) {
        Utils.logError("Topico es invalido:");
        Utils.logError(`    ${topic} != ${topic_}`);
        return;
    }

    // debe venir la temperatura
    const temperatura = Number(payload.temperatura);
    if (isNaN(temperatura)) {
        Utils.logError("Valor de TEMPERATURA es invalido");
        return;
    }

    // debe venir la humedad
    const humedad = Number(payload.humedad);
    if (isNaN(humedad)) {
        Utils.logError("Valor de HUMEDAD es invalido");
        return;
    }

    // necesitamops tipo y ubicacion del nodo (no tenemos gps aun)
    //   + debe estar en la base de datos
    //   + debe estar activo
    //   + usamos su georeferenciacion activo
    let nodo_tipo;
    let nodo_latitud
    let nodo_longitud;
    try {
        const sql = 'SELECT n.tipo, nu.latitud, nu.longitud ' +
            'FROM nodo n ' +
            'INNER JOIN nodo_ubicacion nu ON n.id = nu.nodo_id and nu.activo = 1 ' +
            'WHERE n.id = ? and n.activo = 1';
        const [rows] = await db.query(sql, [nodo_id]);
        if (rows.length != 1) {
            Utils.logError("Nodo no existe en la Base de Datos:");
            Utils.logError(`    ${nodo_id}`);
            return;
        }
        nodo_tipo = rows[0].tipo;
        nodo_latitud = rows[0].latitud;
        nodo_longitud = rows[0].longitud;
    } catch (err) {
        Utils.logError("Error al recuperar datos del nodo desde la Base de Datos:");
        Utils.logError(`    ${err.message}`);
        return;
    }

    // (solo) si es COLMENA debe venir el peso
    let peso = payload.peso;
    if (nodo_tipo == "COLMENA") {
        peso = Number(peso);
        if (isNaN(peso)) {
            Utils.logError("Valor de PESO es invalido");
            return;
        }
    }
    else {
        if (peso != undefined) {
            Utils.logError("PESO no es valido para este nodo");
            return;
        }
    }

    // almacenamos en la BD
    let msg = {
        nodo_id: nodo_id,
        temperatura: temperatura,
        humedad: humedad,
        latitud: nodo_latitud,
        longitud: nodo_longitud
    }
    if (nodo_tipo == "COLMENA")
        msg.peso = peso;
    msg = JSON.stringify(msg);
    try {
        const sql = "INSERT INTO nodo_mensaje(nodo_id, topico, payload) VALUES(?, ?, ?)";
        await db.query(sql, [nodo_id, topic, msg]);
    } catch (err) {
        Utils.logError(`Error al insertar mensaje en la Base de Datos:`);
        Utils.logError(`    ${err.message}`);
        return;
    }

    // mostramos lo recibido
    Utils.logInfo("Datos almacenados en la Base de Datos:");
    Utils.logInfo(`    ${nodo_id}`)
    Utils.logInfo(`    ${topic}`)
    Utils.logInfo(`    ${msg}`)

    // eso es todo
    return;
};
