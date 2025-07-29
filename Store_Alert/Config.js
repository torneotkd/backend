import { readFileSync } from 'fs';

// carga certificado del CA
const CA = readFileSync('<Ubicacion del certifica del CA>');

// configuración del usuario MQTT
const USER = "<ID del usuario MQTT Store&Alert>";
const PASS = "<CLAVE del usuario MQTT Store&Alert>";
const TOPIC = "SmartBee/nodes/+/data";

// configuración del ID de un nodo ambiental para pruebas
const node_id = "<ID del nodo ambiental para pruebas>";

// configuración de la base de datos
const db = {
    host: "127.0.0.1",
    port: 3306,
    database: "smartbee",
    user: "<ID del usuario que almacena en la base de datos>",
    password: "<CLAVE del usuario que almacena en la base de datos>"
};

// configuraciones MQTT disponibles
const mqttWSS = {
    url: "wss://smartbee.cl:443/apps/mqtt.rcr",
    ca: CA,
    username: USER,
    password: PASS,
    topic: TOPIC,
};

const mqttTLS = {
    url: "mqtts://smartbee.cl:8885",
    ca: CA,
    username: USER,
    password: PASS,
    topic: TOPIC,
};

const mqttPLAIN = {
    url: "mqtt://127.0.0.1:1884",
    ca: null,
    username: USER,
    password: PASS,
    topic: TOPIC,
};

// configuracion MQTT a utilizar
const mqtt = mqttPLAIN;

// para depurar en la consola
const debug = true;

// la configuracion a exportar
const config = {
    db,
    mqtt,
    node_id,
    debug
};

export default config;