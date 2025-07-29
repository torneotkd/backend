import { readFileSync } from 'fs';

const CA = null;
const USER = "smartbee_user";           // ← Usuario que crearás
const PASS = "smartbee123";             // ← Password que crearás
const TOPIC = "SmartBee/nodes/+/data";
const node_id = "NODO-7881883A-97A5-47E0-869C-753E99E1B168";

const db = {
    host: "crossover.proxy.rlwy.net",
    port: 23151,
    database: "railway",
    user: "root",
    password: "DwPLKjZIkHdyGcjLmnsmQIwWvDjisbBm"
};

const mqttWSS = {
    url: "wss://smartbee.cl:443/apps/mqtt.rcr",
    ca: CA,
    username: USER,
    password: PASS,
    topic: TOPIC,
};

const mqttTLS = {
    url: "mqtts://n0740bf0.ala.us-east-1.emqxsl.com:8883",  // ← Tu servidor EMQX
    ca: null,
    username: USER,
    password: PASS,
    topic: TOPIC,
};

const mqttPLAIN = {
    url: "mqtt://n0740bf0.ala.us-east-1.emqxsl.com:1883",   // ← Tu servidor EMQX (puerto normal)
    ca: null,
    username: USER,
    password: PASS,
    topic: TOPIC,
};

// Usar TLS para conexión segura
const mqtt = mqttTLS;
const debug = true;

const config = {
    db,
    mqtt,
    nodo_id: node_id,
    debug
};

export default config;