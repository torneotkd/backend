const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

// Configuración de Railway MySQL usando variables de entorno
const dbConfig = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: {
        rejectUnauthorized: false
    }
};
const pool = mysql.createPool(dbConfig);

app.use(cors({
  origin: [
    'https://datos-github-io-gamma.vercel.app', // Tu dominio de Vercel
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:8080'
  ],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware de logging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// =============================================
// RUTAS BÁSICAS
// =============================================

// Ruta de salud
app.get('/api/health', (req, res) => {
    res.json({ 
        message: 'SmartBee API funcionando correctamente',
        timestamp: new Date().toISOString(),
        database: 'Railway MySQL'
    });
});

// Probar conexión a base de datos
app.get('/api/test-db', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT 1 as test, NOW() as timestamp');
        res.json({ 
            connected: true,
            test: rows[0].test,
            timestamp: rows[0].timestamp
        });
    } catch (error) {
        console.error('Error en test-db:', error);
        res.status(500).json({ 
            connected: false,
            error: error.message
        });
    }
});


// REEMPLAZA tu ruta de login actual con esta versión más robusta

app.post('/api/usuarios/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        console.log('🔐 Login attempt:', { email, timestamp: new Date().toISOString() });
        
        if (!email || !password) {
            return res.status(400).json({ 
                error: 'Email y contraseña son requeridos' 
            });
        }
        
        // Primero, verificar si la tabla usuario existe y tiene datos
        console.log('📊 Verificando tabla usuario...');
        const [tableCheck] = await pool.execute('SELECT COUNT(*) as count FROM usuario LIMIT 1');
        console.log('✅ Tabla usuario accesible, registros:', tableCheck[0].count);
        
        // Buscar usuario SIN hacer JOIN con rol (por si no existe)
        console.log('🔍 Buscando usuario:', email);
        const [rows] = await pool.execute(`
            SELECT id, nombre, apellido, email, telefono, clave, fecha_registro, rol
            FROM usuario 
            WHERE email = ?
        `, [email]);
        
        console.log('📋 Usuarios encontrados:', rows.length);
        
        if (rows.length === 0) {
            console.log('❌ Usuario no encontrado:', email);
            return res.status(401).json({ 
                error: 'Credenciales inválidas' 
            });
        }
        
        const usuario = rows[0];
        console.log('👤 Usuario encontrado:', { 
            id: usuario.id, 
            email: usuario.email,
            hasPassword: !!usuario.clave 
        });
        
        // Verificar contraseña con manejo de errores
        let validPassword = false;
        try {
            if (usuario.clave) {
                validPassword = await bcrypt.compare(password, usuario.clave);
                console.log('🔑 Verificación de contraseña:', validPassword);
            } else {
                console.log('⚠️ Usuario sin contraseña hash');
            }
        } catch (bcryptError) {
            console.error('💥 Error en bcrypt:', bcryptError.message);
            
            // Fallback: comparación directa (solo para desarrollo)
            if (usuario.clave === password) {
                console.log('🔓 Contraseña válida (texto plano - desarrollo)');
                validPassword = true;
            }
        }
        
        if (!validPassword) {
            console.log('❌ Contraseña incorrecta para:', email);
            return res.status(401).json({ 
                error: 'Credenciales inválidas' 
            });
        }
        
        // Intentar obtener rol (opcional)
        let rol_nombre = 'Usuario';
        try {
            const [rolRows] = await pool.execute('SELECT descripcion FROM rol WHERE id = ?', [usuario.rol]);
            if (rolRows.length > 0) {
                rol_nombre = rolRows[0].descripcion;
            }
        } catch (rolError) {
            console.log('⚠️ No se pudo obtener rol:', rolError.message);
        }
        
        // Login exitoso
        console.log('✅ Login exitoso:', { id: usuario.id, email: usuario.email });
        
        // Preparar respuesta
        const { clave, ...usuarioSinClave } = usuario;
        usuarioSinClave.rol_nombre = rol_nombre;
        
        // Token simple
        const token = `smartbee_${usuario.id}_${Date.now()}`;
        
        res.json({
            data: {
                token: token,
                usuario: usuarioSinClave
            },
            message: 'Login exitoso'
        });
        
    } catch (error) {
        console.error('💥 Error completo en login:', {
            message: error.message,
            stack: error.stack,
            sql: error.sql || 'No SQL error'
        });
        
        res.status(500).json({ 
            error: 'Error interno del servidor',
            details: process.env.NODE_ENV === 'development' ? error.message : 'Error en autenticación'
        });
    }
});

// RUTA PARA CREAR USUARIO DE PRUEBA (mejorada)
app.post('/api/crear-usuario-prueba', async (req, res) => {
    try {
        console.log('🧪 Creando usuario de prueba...');
        
        // Verificar si ya existe
        const [existing] = await pool.execute('SELECT id FROM usuario WHERE email = ?', ['admin']);
        if (existing.length > 0) {
            console.log('👤 Usuario admin ya existe');
            return res.json({ 
                message: 'Usuario admin ya existe',
                credentials: { email: 'admin', password: 'admin123' },
                existingUser: existing[0]
            });
        }
        
        // Crear password hash
        let hashedPassword;
        try {
            hashedPassword = await bcrypt.hash('admin123', 10);
            console.log('🔐 Password hash creado');
        } catch (bcryptError) {
            console.log('⚠️ Error con bcrypt, usando texto plano');
            hashedPassword = 'admin123'; // Fallback para desarrollo
        }
        
        // Verificar qué rol usar
        let rolId = 1;
        try {
            const [roles] = await pool.execute('SELECT id FROM rol LIMIT 1');
            if (roles.length > 0) {
                rolId = roles[0].id;
                console.log('📋 Usando rol ID:', rolId);
            }
        } catch (rolError) {
            console.log('⚠️ Tabla rol no disponible, usando NULL');
            rolId = null;
        }
        
        const [result] = await pool.execute(`
            INSERT INTO usuario (nombre, apellido, email, telefono, clave, rol) 
            VALUES (?, ?, ?, ?, ?, ?)
        `, ['Admin', 'SmartBee', 'admin', '+56912345678', hashedPassword, rolId]);
        
        console.log('✅ Usuario creado con ID:', result.insertId);
        
        res.json({ 
            id: result.insertId,
            message: 'Usuario de prueba creado exitosamente',
            credentials: { 
                email: 'admin', 
                password: 'admin123' 
            },
            usesHash: hashedPassword !== 'admin123'
        });
        
    } catch (error) {
        console.error('💥 Error creando usuario de prueba:', error);
        res.status(500).json({ 
            error: 'Error creando usuario de prueba',
            details: error.message
        });
    }
});
// AGREGAR EXACTAMENTE AQUÍ - después del login y antes de las rutas de usuarios

// Arreglar password del usuario admin
app.post('/api/fix-admin-password', async (req, res) => {
    try {
        console.log('🔧 Arreglando password del usuario admin...');
        
        // Buscar usuario admin
        const [adminUser] = await pool.execute(`
            SELECT id, email, clave 
            FROM usuario 
            WHERE email = ?
        `, ['admin@smartbee.com']);
        
        if (adminUser.length === 0) {
            return res.status(404).json({
                error: 'Usuario admin@smartbee.com no encontrado'
            });
        }
        
        const usuario = adminUser[0];
        console.log('👤 Usuario encontrado:', {
            id: usuario.id,
            email: usuario.email,
            currentPasswordLength: usuario.clave ? usuario.clave.length : 0,
            isBcryptHash: usuario.clave && usuario.clave.startsWith('$2')
        });
        
        // Crear nuevo hash bcrypt correcto
        const newPassword = 'admin123';
        const newHash = await bcrypt.hash(newPassword, 10);
        
        console.log('🔐 Nuevo hash creado correctamente');
        
        // Actualizar password en la base de datos
        await pool.execute(`
            UPDATE usuario 
            SET clave = ?
            WHERE id = ?
        `, [newHash, usuario.id]);
        
        // Verificar que funciona
        const testResult = await bcrypt.compare(newPassword, newHash);
        
        console.log('✅ Password actualizado y verificado');
        
        res.json({
            success: true,
            message: 'Password del usuario admin actualizado correctamente',
            userId: usuario.id,
            email: usuario.email,
            testResult: testResult,
            credentials: {
                email: 'admin@smartbee.com',
                password: 'admin123'
            }
        });
        
    } catch (error) {
        console.error('💥 Error arreglando password:', error);
        res.status(500).json({
            error: error.message
        });
    }
});

// Test login con debugging
app.post('/api/test-login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        console.log('🧪 Test login:', { email });
        
        // Buscar usuario
        const [rows] = await pool.execute(`
            SELECT id, nombre, apellido, email, clave
            FROM usuario 
            WHERE email = ?
        `, [email]);
        
        if (rows.length === 0) {
            return res.json({
                success: false,
                message: 'Usuario no encontrado',
                email: email
            });
        }
        
        const usuario = rows[0];
        
        // Test bcrypt
        let bcryptResult = false;
        let bcryptError = null;
        
        try {
            bcryptResult = await bcrypt.compare(password, usuario.clave);
        } catch (error) {
            bcryptError = error.message;
        }
        
        res.json({
            success: bcryptResult,
            email: email,
            userId: usuario.id,
            bcryptResult: bcryptResult,
            bcryptError: bcryptError
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 👇 AQUÍ CONTINÚAN LAS RUTAS EXISTENTES DE USUARIOS
// Obtener todos los usuarios
app.get('/api/usuarios', async (req, res) => {
    try {
        const [rows] = await pool.execute(`
            SELECT u.id, u.nombre, u.apellido, u.email, u.telefono, u.fecha_registro, r.descripcion as rol_descripcion 
            FROM usuario u 
            JOIN rol r ON u.rol = r.id 
            ORDER BY u.fecha_registro DESC
        `);
        res.json(rows);
    } catch (error) {
        console.error('Error obteniendo usuarios:', error);
        res.status(500).json({ error: 'Error obteniendo usuarios', details: error.message });
    }
});

// Crear nuevo usuario
app.post('/api/usuarios', async (req, res) => {
    try {
        const { nombre, apellido, email, telefono, clave, rol = 2 } = req.body;
        
        // Verificar si el email ya existe
        const [existing] = await pool.execute('SELECT id FROM usuario WHERE email = ?', [email]);
        if (existing.length > 0) {
            return res.status(400).json({ error: 'El email ya está registrado' });
        }
        
        // Hash de la contraseña
        const hashedPassword = await bcrypt.hash(clave, 10);
        
        const [result] = await pool.execute(`
            INSERT INTO usuario (nombre, apellido, email, telefono, clave, rol) 
            VALUES (?, ?, ?, ?, ?, ?)
        `, [nombre, apellido, email, telefono, hashedPassword, rol]);
        
        res.json({ 
            id: result.insertId,
            message: 'Usuario creado exitosamente'
        });
    } catch (error) {
        console.error('Error creando usuario:', error);
        res.status(500).json({ error: 'Error creando usuario', details: error.message });
    }
});

// =============================================
// RUTAS PARA APIARIOS
// =============================================

// Obtener todos los apiarios
app.get('/api/apiarios', async (req, res) => {
    try {
        const [rows] = await pool.execute(`
            SELECT a.*, u.nombre as propietario_nombre, u.apellido as propietario_apellido,
                   COUNT(c.id) as total_colmenas
            FROM apiario a 
            JOIN usuario u ON a.usuario_id = u.id 
            LEFT JOIN colmena c ON c.apiario_id = a.id
            GROUP BY a.id
            ORDER BY a.fecha_creacion DESC
        `);
        res.json(rows);
    } catch (error) {
        console.error('Error obteniendo apiarios:', error);
        res.status(500).json({ error: 'Error obteniendo apiarios', details: error.message });
    }
});

// Crear nuevo apiario
app.post('/api/apiarios', async (req, res) => {
    try {
        const { nombre, ubicacion, descripcion, usuario_id = 2 } = req.body;
        
        const [result] = await pool.execute(`
            INSERT INTO apiario (nombre, ubicacion, descripcion, usuario_id) 
            VALUES (?, ?, ?, ?)
        `, [nombre, ubicacion, descripcion, usuario_id]);
        
        res.json({ 
            id: result.insertId,
            message: 'Apiario creado exitosamente'
        });
    } catch (error) {
        console.error('Error creando apiario:', error);
        res.status(500).json({ error: 'Error creando apiario', details: error.message });
    }
});

// =============================================
// RUTAS PARA COLMENAS
// =============================================

// Obtener todas las colmenas
app.get('/api/colmenas', async (req, res) => {
    try {
        const [rows] = await pool.execute(`
            SELECT c.*, a.nombre as apiario_nombre, u.nombre as dueno_nombre, u.apellido as dueno_apellido
            FROM colmena c 
            LEFT JOIN apiario a ON c.apiario_id = a.id 
            JOIN usuario u ON c.dueno = u.id 
            ORDER BY c.fecha_instalacion DESC
        `);
        res.json(rows);
    } catch (error) {
        console.error('Error obteniendo colmenas:', error);
        res.status(500).json({ error: 'Error obteniendo colmenas', details: error.message });
    }
});

// Obtener colmenas activas para selects
app.get('/api/colmenas/activas', async (req, res) => {
    try {
        const [rows] = await pool.execute(`
            SELECT id, nombre FROM colmena WHERE estado = 'activa' ORDER BY nombre
        `);
        res.json(rows);
    } catch (error) {
        console.error('Error obteniendo colmenas activas:', error);
        res.status(500).json({ error: 'Error obteniendo colmenas activas', details: error.message });
    }
});

// Crear nueva colmena
app.post('/api/colmenas', async (req, res) => {
    try {
        const { nombre, tipo, descripcion, dueno, apiario_id } = req.body;
        
        const [result] = await pool.execute(`
            INSERT INTO colmena (nombre, tipo, descripcion, dueno, apiario_id) 
            VALUES (?, ?, ?, ?, ?)
        `, [nombre, tipo, descripcion, dueno, apiario_id]);
        
        res.json({ 
            id: result.insertId,
            message: 'Colmena creada exitosamente'
        });
    } catch (error) {
        console.error('Error creando colmena:', error);
        res.status(500).json({ error: 'Error creando colmena', details: error.message });
    }
});

// =============================================
// RUTAS PARA REVISIONES
// =============================================

// Obtener todas las revisiones
app.get('/api/revisiones', async (req, res) => {
    try {
        const [rows] = await pool.execute(`
            SELECT r.*, c.nombre as colmena_nombre, u.nombre as inspector_nombre, u.apellido as inspector_apellido
            FROM revision r 
            JOIN colmena c ON r.colmena_id = c.id 
            JOIN usuario u ON r.usuario_id = u.id 
            ORDER BY r.fecha_revision DESC
        `);
        res.json(rows);
    } catch (error) {
        console.error('Error obteniendo revisiones:', error);
        res.status(500).json({ error: 'Error obteniendo revisiones', details: error.message });
    }
});

// Crear nueva revisión
app.post('/api/revisiones', async (req, res) => {
    try {
        const { 
            colmena_id, fecha_revision, num_alzas, marcos_abejas, marcos_cria, 
            marcos_alimento, marcos_polen, presencia_varroa, condicion_reina,
            producto_sanitario, dosis_sanitario, temperatura, humedad, peso, 
            notas, usuario_id = 2 
        } = req.body;
        
        const [result] = await pool.execute(`
            INSERT INTO revision (
                colmena_id, fecha_revision, num_alzas, marcos_abejas, marcos_cria,
                marcos_alimento, marcos_polen, presencia_varroa, condicion_reina,
                producto_sanitario, dosis_sanitario, temperatura, humedad, peso,
                notas, usuario_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            colmena_id, fecha_revision, num_alzas, marcos_abejas, marcos_cria,
            marcos_alimento, marcos_polen, presencia_varroa, condicion_reina,
            producto_sanitario, dosis_sanitario, temperatura, humedad, peso,
            notas, usuario_id
        ]);
        
        res.json({ 
            id: result.insertId,
            message: 'Revisión registrada exitosamente'
        });
    } catch (error) {
        console.error('Error registrando revisión:', error);
        res.status(500).json({ error: 'Error registrando revisión', details: error.message });
    }
});

// =============================================
// RUTAS PARA DASHBOARD
// =============================================

// Obtener estadísticas del dashboard
app.get('/api/dashboard/stats', async (req, res) => {
    try {
        const [usuarios] = await pool.execute('SELECT COUNT(*) as count FROM usuario');
        const [apiarios] = await pool.execute('SELECT COUNT(*) as count FROM apiario');
        const [colmenas] = await pool.execute('SELECT COUNT(*) as count FROM colmena');
        const [revisiones] = await pool.execute('SELECT COUNT(*) as count FROM revision');
        
        res.json({
            usuarios: usuarios[0].count,
            apiarios: apiarios[0].count,
            colmenas: colmenas[0].count,
            revisiones: revisiones[0].count
        });
    } catch (error) {
        console.error('Error obteniendo estadísticas:', error);
        res.status(500).json({ error: 'Error obteniendo estadísticas', details: error.message });
    }
});

// Obtener actividades recientes
app.get('/api/dashboard/recent', async (req, res) => {
    try {
        const [rows] = await pool.execute(`
            SELECT r.*, c.nombre as colmena_nombre, u.nombre as usuario_nombre 
            FROM revision r 
            JOIN colmena c ON r.colmena_id = c.id 
            JOIN usuario u ON r.usuario_id = u.id 
            ORDER BY r.fecha_revision DESC 
            LIMIT 4
        `);
        res.json(rows);
    } catch (error) {
        console.error('Error obteniendo actividades recientes:', error);
        res.status(500).json({ error: 'Error obteniendo actividades recientes', details: error.message });
    }
});

// =============================================
// RUTAS AUXILIARES PARA SELECTS
// =============================================

// Obtener usuarios para selects
app.get('/api/select/usuarios', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT id, nombre, apellido FROM usuario ORDER BY nombre');
        res.json(rows);
    } catch (error) {
        console.error('Error obteniendo usuarios para select:', error);
        res.status(500).json({ error: 'Error obteniendo usuarios', details: error.message });
    }
});

// Obtener apiarios para selects
app.get('/api/select/apiarios', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT id, nombre FROM apiario ORDER BY nombre');
        res.json(rows);
    } catch (error) {
        console.error('Error obteniendo apiarios para select:', error);
        res.status(500).json({ error: 'Error obteniendo apiarios', details: error.message });
    }
});

// =============================================
// MIDDLEWARE DE MANEJO DE ERRORES
// =============================================

app.use((err, req, res, next) => {
    console.error('Error:', err.stack);
    res.status(500).json({ 
        message: 'Error interno del servidor',
        error: process.env.NODE_ENV === 'development' ? err.message : {}
    });
});

// Ruta 404
app.use('*', (req, res) => {
    res.status(404).json({ message: 'Ruta no encontrada' });
});

// =============================================
// INICIAR SERVIDOR
// =============================================

const startServer = async () => {
    try {
        // Probar conexión a base de datos
        console.log('🔄 Probando conexión a Railway...');
        const connection = await pool.getConnection();
        console.log('✅ Conexión exitosa a Railway MySQL');
        connection.release();
        
        app.listen(PORT, () => {
            console.log(`🚀 Servidor SmartBee ejecutándose en puerto ${PORT}`);
            console.log(`🌐 API disponible en: http://localhost:${PORT}/api`);
            console.log(`🗄️  Base de datos: Railway MySQL`);
            console.log(`📋 Endpoints principales:`);
            console.log(`   GET  /api/health - Estado del servidor`);
            console.log(`   GET  /api/test-db - Prueba de base de datos`);
            console.log(`   GET  /api/usuarios - Obtener usuarios`);
            console.log(`   POST /api/usuarios - Crear usuario`);
            console.log(`   GET  /api/apiarios - Obtener apiarios`);
            console.log(`   POST /api/apiarios - Crear apiario`);
            console.log(`   GET  /api/colmenas - Obtener colmenas`);
            console.log(`   POST /api/colmenas - Crear colmena`);
            console.log(`   GET  /api/revisiones - Obtener revisiones`);
            console.log(`   POST /api/revisiones - Crear revisión`);
            console.log(`   GET  /api/dashboard/stats - Estadísticas`);
            console.log(`   GET  /api/dashboard/recent - Actividades recientes`);
        });
    } catch (error) {
        console.error('❌ Error conectando a Railway:', error.message);
        console.log('⚠️  Iniciando servidor sin base de datos...');
        
        app.listen(PORT, () => {
            console.log(`🚀 Servidor SmartBee (modo desarrollo) en puerto ${PORT}`);
            console.log(`⚠️  Sin conexión a base de datos`);
        });
    }
};

startServer();

// Manejo de cierre
process.on('SIGINT', async () => {
    console.log('\n🔄 Cerrando servidor...');
    await pool.end();
    console.log('✅ Pool de conexiones cerrado');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🔄 Cerrando servidor...');
    await pool.end();
    console.log('✅ Pool de conexiones cerrado');
    process.exit(0);
});
