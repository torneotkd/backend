// ===========================================
// 📁 backend/config/database.js
// ===========================================
const mysql = require('mysql2/promise');
require('dotenv').config();

// Configuración de la conexión a Railway
const dbConfig = {
    host: process.env.DB_HOST || 'trolley.proxy.rlwy.net',
    port: process.env.DB_PORT || 22836,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'udiRYhhpLDVVLOmZgLqsxOSBdUfmEFaz',
    database: process.env.DB_NAME || 'railway',
    // Configuraciones adicionales para Railway
    ssl: {
        rejectUnauthorized: false
    },
    connectTimeout: 60000,
    acquireTimeout: 60000,
    timeout: 60000
};

// Crear pool de conexiones
const pool = mysql.createPool(dbConfig);

// Función para probar la conexión
const testConnection = async () => {
    try {
        const connection = await pool.getConnection();
        console.log('✅ Conexión exitosa a Railway MySQL');
        connection.release();
        return true;
    } catch (error) {
        console.error('❌ Error conectando a la base de datos:', error.message);
        return false;
    }
};

module.exports = {
    pool,
    testConnection
};

