// app.js (en la raíz, junto a server.js)
import { spawn } from 'child_process';
import path from 'path';

console.log('🚀 Iniciando SmartBee Backend Completo...');

// Ejecutar server.js (backend web)
const webServer = spawn('node', ['server.js'], {
    stdio: ['inherit', 'inherit', 'inherit']
});

// Ejecutar Store.js (MQTT) desde la carpeta Store_Alert
const mqttServer = spawn('node', ['Store_Alert/Store.js'], {
    stdio: ['inherit', 'inherit', 'inherit'],
    cwd: process.cwd()
});

console.log('✅ Web Server (server.js) iniciado');
console.log('✅ MQTT Store (Store_Alert/Store.js) iniciado');

// Manejar eventos
webServer.on('close', (code) => {
    console.log(`❌ Web Server terminó con código ${code}`);
    process.exit(code);
});

mqttServer.on('close', (code) => {
    console.log(`❌ MQTT Store terminó con código ${code}`);
    process.exit(code);
});

webServer.on('error', (err) => {
    console.error('❌ Error en Web Server:', err);
});

mqttServer.on('error', (err) => {
    console.error('❌ Error en MQTT Store:', err);
});

// Manejar cierre del proceso principal
process.on('SIGINT', () => {
    console.log('🛑 Cerrando aplicación...');
    webServer.kill();
    mqttServer.kill();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('🛑 Cerrando aplicación...');
    webServer.kill();
    mqttServer.kill();
    process.exit(0);
});