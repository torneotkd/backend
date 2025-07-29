import { connectAsync as mqttConnectAsync } from 'mqtt';
import { v4 as uuidv4 } from 'uuid';
import { once, EventEmitter } from 'events';

import config from './Config (Secret).js';
import Utils from './Utils.js';
Utils.logEnabled = true;

let nveces;
let delay;

if (process.argv.length == 4) {
    nveces = Number(process.argv[2]);
    delay = Number(process.argv[3]);
}

if (isNaN(nveces) || isNaN(delay)) {
    Utils.logError("Uso:");
    Utils.logError("    node TestSend.js <nveces> <delay> (en ms)");
    Utils.logError("");
    Utils.logError("Ejemplo - Para enviar 100 mensajes a intervalos de 1000 ms utilizando la configuracion por defecto:");
    Utils.logError("     node TestSend.js 100 1000\n");
    process.exit(1);
}

Utils.logInfo("Iniciando Programa");
let mqttClient;

await main(nveces, delay);
Utils.logInfo("Finalizando Programa");

// -------------------------
async function main(nveces, delay) {
    // nos conectamos al servidor mqtt
    try {
        const mqttClientId = 'TEST-APP-' + uuidv4();
        Utils.logInfo(`Conectando al broker ${config.mqtt.url}`);
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
        Utils.logError("No se pudo conectar con el broker:");
        Utils.logError(`    ${err.message}`);
        return;
    }

    Utils.logInfo("Iniciando el envio masivo de mensajes");
    await testSecuencial(nveces, delay);
    await testParalelo(nveces, delay);
    Utils.logInfo("Finalizado el envio masivo de mensajes");

    Utils.logInfo('Finalizando la conexion con el broker');
    mqttClient.end(true);
    Utils.logInfo('Finalizada la conexion con el broker');

    Utils.logInfo("Saliendo de main")
}

// ------
async function testSecuencial(nveces, delay) {
    const nodo_id = config.nodo_id;
    const topico = 'SmartBee/nodes/' + nodo_id + '/data';
    const message = {
        nodo_id: nodo_id,
        temperatura: 0,
        humedad: 0,
        peso: 0
    };

    const event = new EventEmitter();
    const t0 = performance.now();
    for (let i = 1; i <= nveces; i++) {
        message.temperatura = Math.random() * 5 + 25;
        message.humedad = Math.random() * 10 + 60;
        message.peso = Math.random() * 5 + 20;

        mqttClient.publish(topico, JSON.stringify(message), { qos: 2 }, (err) => {
            if (err) {
                Utils.logError("Error al publicar:");
                Utils.logError(`    ${err.message}`);
            }
            event.emit('published');
        });
        await once(event, 'published');
        if (delay > 0) await Utils.pause(delay);
    }
    const t1 = performance.now();
    Utils.logInfo(`   => Test Secuencial: Se enviaron ${nveces} mensajes en ${t1 - t0} ms`);
}

async function testParalelo(nveces) {
    const nodo_id = config.nodo_id;
    const topico = 'SmartBee/nodes/' + nodo_id + '/data';
    const promesas = [];
    const t0 = performance.now()
    for (let i = 1; i <= nveces; i++) {
        const promesa = new Promise((resolv) => {
            const message = {
                nodo_id: nodo_id,
                temperatura: Math.random() * 5 + 25,
                humedad: Math.random() * 10 + 60,
                peso: Math.random() * 5 + 20
            };
            mqttClient.publish(topico, JSON.stringify(message), { qos: 2 }, (err) => {
                if (err) {
                    Utils.logError("Error al publicar:");
                    Utils.logError(`    ${err.message}`);
                }
                resolv();
            });
        });
        promesas.push(promesa);
    }
    await Promise.all(promesas);
    const t1 = performance.now();
    Utils.logInfo(`   => Test Paralelo  : Se enviaron ${nveces} mensajes en ${t1 - t0} ms`);
}

