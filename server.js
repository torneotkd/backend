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
    'https://datos-github-io-gamma.vercel.app',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:8080'
  ],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware para logging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Middleware para manejo de errores
const handleError = (res, error, message = 'Error interno del servidor') => {
    console.error('❌ Error:', error);
    res.status(500).json({ 
        error: message,
        details: error.message 
    });
};

// Middleware para validar conexión a BD
const validateConnection = async (req, res, next) => {
    try {
        await pool.execute('SELECT 1');
        next();
    } catch (error) {
        console.error('❌ Error de conexión a BD:', error);
        res.status(503).json({ 
            error: 'Error de conexión a la base de datos',
            details: error.message 
        });
    }
};

// ================================
// RUTAS DE HEALTH CHECK
// ================================

app.get('/', (req, res) => {
    res.json({ 
        message: 'SmartBee API v1.0',
        status: 'running',
        timestamp: new Date().toISOString()
    });
});

app.get('/health', async (req, res) => {
    try {
        await pool.execute('SELECT 1');
        res.json({ 
            status: 'healthy',
            database: 'connected',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(503).json({ 
            status: 'unhealthy',
            database: 'disconnected',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ================================
// RUTAS DE DASHBOARD
// ================================

app.get('/api/dashboard/stats', validateConnection, async (req, res) => {
    try {
        console.log('📊 Obteniendo estadísticas del dashboard');
        
        const [colmenasResult] = await pool.execute('SELECT COUNT(*) as total, SUM(activa) as activas FROM colmenas');
        const [usuariosResult] = await pool.execute('SELECT COUNT(*) as total FROM usuarios');
        
        // Mensajes de hoy (últimas 24 horas)
        const [mensajesResult] = await pool.execute(`
            SELECT COUNT(*) as total 
            FROM mensajes 
            WHERE fecha >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        `);
        
        const stats = {
            totalColmenas: colmenasResult[0]?.total || 0,
            colmenasActivas: colmenasResult[0]?.activas || 0,
            totalUsuarios: usuariosResult[0]?.total || 0,
            mensajesHoy: mensajesResult[0]?.total || 0
        };
        
        console.log('✅ Estadísticas calculadas:', stats);
        res.json(stats);
    } catch (error) {
        handleError(res, error, 'Error al obtener estadísticas del dashboard');
    }
});

// ================================
// RUTAS DE USUARIOS
// ================================

app.get('/api/usuarios', validateConnection, async (req, res) => {
    try {
        console.log('👥 Obteniendo lista de usuarios');
        const [rows] = await pool.execute(`
            SELECT u.id, u.nombre, u.apellido, u.rol, u.activo, r.descripcion as rol_descripcion
            FROM usuarios u
            LEFT JOIN roles r ON u.rol = r.rol
            ORDER BY u.nombre, u.apellido
        `);
        
        console.log(`✅ ${rows.length} usuarios encontrados`);
        res.json(rows);
    } catch (error) {
        handleError(res, error, 'Error al obtener usuarios');
    }
});

app.get('/api/usuarios/:id', validateConnection, async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`👤 Obteniendo usuario: ${id}`);
        
        const [rows] = await pool.execute(`
            SELECT u.id, u.nombre, u.apellido, u.rol, u.activo, r.descripcion as rol_descripcion
            FROM usuarios u
            LEFT JOIN roles r ON u.rol = r.rol
            WHERE u.id = ?
        `, [id]);
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        res.json(rows[0]);
    } catch (error) {
        handleError(res, error, 'Error al obtener usuario');
    }
});

app.post('/api/usuarios', validateConnection, async (req, res) => {
    try {
        const { id, nombre, apellido, clave, rol } = req.body;
        
        // Validaciones
        if (!id || !nombre || !apellido || !clave || !rol) {
            return res.status(400).json({ 
                error: 'Todos los campos son requeridos: id, nombre, apellido, clave, rol' 
            });
        }
        
        if (id.length > 16) {
            return res.status(400).json({ error: 'El ID no puede exceder 16 caracteres' });
        }
        
        console.log(`➕ Creando usuario: ${id}`);
        
        // Verificar que el rol existe
        const [roleCheck] = await pool.execute('SELECT rol FROM roles WHERE rol = ?', [rol]);
        if (roleCheck.length === 0) {
            return res.status(400).json({ error: 'El rol especificado no existe' });
        }
        
        // Encriptar clave
        const hashedPassword = await bcrypt.hash(clave, 10);
        
        // Insertar usuario
        await pool.execute(`
            INSERT INTO usuarios (id, nombre, apellido, clave, rol, activo)
            VALUES (?, ?, ?, ?, ?, 1)
        `, [id, nombre, apellido, hashedPassword, rol]);
        
        console.log(`✅ Usuario creado: ${id}`);
        res.status(201).json({ 
            message: 'Usuario creado exitosamente',
            id: id
        });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            res.status(409).json({ error: 'Ya existe un usuario con ese ID' });
        } else {
            handleError(res, error, 'Error al crear usuario');
        }
    }
});

app.put('/api/usuarios/:id', validateConnection, async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, apellido, clave, rol } = req.body;
        
        // Validaciones
        if (!nombre || !apellido || !rol) {
            return res.status(400).json({ 
                error: 'Los campos nombre, apellido y rol son requeridos' 
            });
        }
        
        console.log(`✏️ Actualizando usuario: ${id}`);
        
        // Verificar que el usuario existe
        const [userCheck] = await pool.execute('SELECT id FROM usuarios WHERE id = ?', [id]);
        if (userCheck.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        // Verificar que el rol existe
        const [roleCheck] = await pool.execute('SELECT rol FROM roles WHERE rol = ?', [rol]);
        if (roleCheck.length === 0) {
            return res.status(400).json({ error: 'El rol especificado no existe' });
        }
        
        // Construir query dinámicamente
        let updateQuery = 'UPDATE usuarios SET nombre = ?, apellido = ?, rol = ?';
        let params = [nombre, apellido, rol];
        
        // Solo actualizar clave si se proporciona
        if (clave && clave.trim()) {
            const hashedPassword = await bcrypt.hash(clave.trim(), 10);
            updateQuery += ', clave = ?';
            params.push(hashedPassword);
        }
        
        updateQuery += ' WHERE id = ?';
        params.push(id);
        
        await pool.execute(updateQuery, params);
        
        console.log(`✅ Usuario actualizado: ${id}`);
        res.json({ message: 'Usuario actualizado exitosamente' });
    } catch (error) {
        handleError(res, error, 'Error al actualizar usuario');
    }
});

app.delete('/api/usuarios/:id', validateConnection, async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`🗑️ Eliminando usuario: ${id}`);
        
        // Verificar que el usuario existe
        const [userCheck] = await pool.execute('SELECT id FROM usuarios WHERE id = ?', [id]);
        if (userCheck.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        // Verificar si tiene colmenas asociadas
        const [colmenasCheck] = await pool.execute('SELECT COUNT(*) as count FROM colmenas WHERE dueno = ?', [id]);
        if (colmenasCheck[0].count > 0) {
            return res.status(409).json({ 
                error: 'No se puede eliminar el usuario porque tiene colmenas asociadas' 
            });
        }
        
        await pool.execute('DELETE FROM usuarios WHERE id = ?', [id]);
        
        console.log(`✅ Usuario eliminado: ${id}`);
        res.json({ message: 'Usuario eliminado exitosamente' });
    } catch (error) {
        handleError(res, error, 'Error al eliminar usuario');
    }
});

// ================================
// RUTAS DE ROLES
// ================================

app.get('/api/roles', validateConnection, async (req, res) => {
    try {
        console.log('🔐 Obteniendo lista de roles');
        const [rows] = await pool.execute('SELECT * FROM roles ORDER BY descripcion');
        
        console.log(`✅ ${rows.length} roles encontrados`);
        res.json(rows);
    } catch (error) {
        handleError(res, error, 'Error al obtener roles');
    }
});

// ================================
// RUTAS DE COLMENAS
// ================================

app.get('/api/colmenas', validateConnection, async (req, res) => {
    try {
        console.log('🏠 Obteniendo lista de colmenas');
        const [rows] = await pool.execute(`
            SELECT c.*, u.nombre as dueno_nombre, u.apellido as dueno_apellido,
                   ub.latitud, ub.longitud, ub.descripcion as ubicacion_descripcion, ub.comuna
            FROM colmenas c
            LEFT JOIN usuarios u ON c.dueno = u.id
            LEFT JOIN ubicaciones ub ON c.id = ub.colmena_id
            ORDER BY c.id
        `);
        
        console.log(`✅ ${rows.length} colmenas encontradas`);
        res.json(rows);
    } catch (error) {
        handleError(res, error, 'Error al obtener colmenas');
    }
});

app.get('/api/colmenas/:id', validateConnection, async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`🏠 Obteniendo colmena: ${id}`);
        
        const [rows] = await pool.execute(`
            SELECT c.*, u.nombre as dueno_nombre, u.apellido as dueno_apellido,
                   ub.latitud, ub.longitud, ub.descripcion as ubicacion_descripcion, ub.comuna
            FROM colmenas c
            LEFT JOIN usuarios u ON c.dueno = u.id
            LEFT JOIN ubicaciones ub ON c.id = ub.colmena_id
            WHERE c.id = ?
        `, [id]);
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Colmena no encontrada' });
        }
        
        res.json(rows[0]);
    } catch (error) {
        handleError(res, error, 'Error al obtener colmena');
    }
});

app.post('/api/colmenas', validateConnection, async (req, res) => {
    try {
        const { descripcion, dueno } = req.body;
        
        // Validaciones
        if (!descripcion || !dueno) {
            return res.status(400).json({ 
                error: 'Los campos descripcion y dueno son requeridos' 
            });
        }
        
        console.log('➕ Creando colmena:', { descripcion, dueno });
        
        // Verificar que el dueño existe
        const [ownerCheck] = await pool.execute('SELECT id FROM usuarios WHERE id = ?', [dueno]);
        if (ownerCheck.length === 0) {
            return res.status(400).json({ error: 'El dueño especificado no existe' });
        }
        
        // Insertar colmena
        const [result] = await pool.execute(`
            INSERT INTO colmenas (descripcion, dueno, activa)
            VALUES (?, ?, 1)
        `, [descripcion, dueno]);
        
        const colmenaId = result.insertId;
        console.log(`✅ Colmena creada con ID: ${colmenaId}`);
        
        res.status(201).json({ 
            message: 'Colmena creada exitosamente',
            id: colmenaId
        });
    } catch (error) {
        handleError(res, error, 'Error al crear colmena');
    }
});

app.put('/api/colmenas/:id', validateConnection, async (req, res) => {
    try {
        const { id } = req.params;
        const { descripcion, dueno } = req.body;
        
        // Validaciones
        if (!descripcion || !dueno) {
            return res.status(400).json({ 
                error: 'Los campos descripcion y dueno son requeridos' 
            });
        }
        
        console.log(`✏️ Actualizando colmena: ${id}`);
        
        // Verificar que la colmena existe
        const [colmenaCheck] = await pool.execute('SELECT id FROM colmenas WHERE id = ?', [id]);
        if (colmenaCheck.length === 0) {
            return res.status(404).json({ error: 'Colmena no encontrada' });
        }
        
        // Verificar que el dueño existe
        const [ownerCheck] = await pool.execute('SELECT id FROM usuarios WHERE id = ?', [dueno]);
        if (ownerCheck.length === 0) {
            return res.status(400).json({ error: 'El dueño especificado no existe' });
        }
        
        await pool.execute(`
            UPDATE colmenas 
            SET descripcion = ?, dueno = ?
            WHERE id = ?
        `, [descripcion, dueno, id]);
        
        console.log(`✅ Colmena actualizada: ${id}`);
        res.json({ message: 'Colmena actualizada exitosamente' });
    } catch (error) {
        handleError(res, error, 'Error al actualizar colmena');
    }
});

app.delete('/api/colmenas/:id', validateConnection, async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`🗑️ Eliminando colmena: ${id}`);
        
        // Verificar que la colmena existe
        const [colmenaCheck] = await pool.execute('SELECT id FROM colmenas WHERE id = ?', [id]);
        if (colmenaCheck.length === 0) {
            return res.status(404).json({ error: 'Colmena no encontrada' });
        }
        
        // Verificar si tiene nodos asociados
        const [nodosCheck] = await pool.execute('SELECT COUNT(*) as count FROM nodos WHERE colmena_id = ?', [id]);
        if (nodosCheck[0].count > 0) {
            return res.status(409).json({ 
                error: 'No se puede eliminar la colmena porque tiene nodos asociados' 
            });
        }
        
        // Eliminar ubicación asociada si existe
        await pool.execute('DELETE FROM ubicaciones WHERE colmena_id = ?', [id]);
        
        // Eliminar colmena
        await pool.execute('DELETE FROM colmenas WHERE id = ?', [id]);
        
        console.log(`✅ Colmena eliminada: ${id}`);
        res.json({ message: 'Colmena eliminada exitosamente' });
    } catch (error) {
        handleError(res, error, 'Error al eliminar colmena');
    }
});

// Endpoint para agregar ubicación a colmena
app.post('/api/colmenas/:id/ubicacion', validateConnection, async (req, res) => {
    try {
        const { id } = req.params;
        const { latitud, longitud, descripcion, comuna } = req.body;
        
        // Validaciones
        if (!latitud || !longitud) {
            return res.status(400).json({ 
                error: 'Los campos latitud y longitud son requeridos' 
            });
        }
        
        console.log(`📍 Agregando ubicación a colmena: ${id}`);
        
        // Verificar que la colmena existe
        const [colmenaCheck] = await pool.execute('SELECT id FROM colmenas WHERE id = ?', [id]);
        if (colmenaCheck.length === 0) {
            return res.status(404).json({ error: 'Colmena no encontrada' });
        }
        
        // Eliminar ubicación anterior si existe
        await pool.execute('DELETE FROM ubicaciones WHERE colmena_id = ?', [id]);
        
        // Insertar nueva ubicación
        await pool.execute(`
            INSERT INTO ubicaciones (colmena_id, latitud, longitud, descripcion, comuna)
            VALUES (?, ?, ?, ?, ?)
        `, [id, latitud, longitud, descripcion || null, comuna || null]);
        
        console.log(`✅ Ubicación agregada a colmena: ${id}`);
        res.json({ message: 'Ubicación agregada exitosamente' });
    } catch (error) {
        handleError(res, error, 'Error al agregar ubicación');
    }
});

// Endpoint para obtener nodos de una colmena
app.get('/api/colmenas/:id/nodos', validateConnection, async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`🔌 Obteniendo nodos de colmena: ${id}`);
        
        const [rows] = await pool.execute(`
            SELECT n.*, tn.descripcion as tipo_descripcion
            FROM nodos n
            LEFT JOIN tipos_nodo tn ON n.tipo = tn.tipo
            WHERE n.colmena_id = ?
            ORDER BY n.id
        `, [id]);
        
        console.log(`✅ ${rows.length} nodos encontrados para colmena ${id}`);
        res.json(rows);
    } catch (error) {
        handleError(res, error, 'Error al obtener nodos de la colmena');
    }
});

// ================================
// RUTAS DE NODOS
// ================================

app.get('/api/nodos', validateConnection, async (req, res) => {
    try {
        console.log('🔌 Obteniendo lista de nodos');
        const [rows] = await pool.execute(`
            SELECT n.*, c.descripcion as colmena_descripcion, tn.descripcion as tipo_descripcion
            FROM nodos n
            LEFT JOIN colmenas c ON n.colmena_id = c.id
            LEFT JOIN tipos_nodo tn ON n.tipo = tn.tipo
            ORDER BY n.id
        `);
        
        console.log(`✅ ${rows.length} nodos encontrados`);
        res.json(rows);
    } catch (error) {
        handleError(res, error, 'Error al obtener nodos');
    }
});

app.get('/api/nodos/:id', validateConnection, async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`🔌 Obteniendo nodo: ${id}`);
        
        const [rows] = await pool.execute(`
            SELECT n.*, c.descripcion as colmena_descripcion, tn.descripcion as tipo_descripcion
            FROM nodos n
            LEFT JOIN colmenas c ON n.colmena_id = c.id
            LEFT JOIN tipos_nodo tn ON n.tipo = tn.tipo
            WHERE n.id = ?
        `, [id]);
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Nodo no encontrado' });
        }
        
        res.json(rows[0]);
    } catch (error) {
        handleError(res, error, 'Error al obtener nodo');
    }
});

app.post('/api/nodos', validateConnection, async (req, res) => {
    try {
        const { descripcion, tipo, colmena_id } = req.body;
        
        // Validaciones
        if (!descripcion || !tipo || !colmena_id) {
            return res.status(400).json({ 
                error: 'Los campos descripcion, tipo y colmena_id son requeridos' 
            });
        }
        
        console.log('➕ Creando nodo:', { descripcion, tipo, colmena_id });
        
        // Verificar que la colmena existe
        const [colmenaCheck] = await pool.execute('SELECT id FROM colmenas WHERE id = ?', [colmena_id]);
        if (colmenaCheck.length === 0) {
            return res.status(400).json({ error: 'La colmena especificada no existe' });
        }
        
        // Verificar que el tipo de nodo existe
        const [tipoCheck] = await pool.execute('SELECT tipo FROM tipos_nodo WHERE tipo = ?', [tipo]);
        if (tipoCheck.length === 0) {
            return res.status(400).json({ error: 'El tipo de nodo especificado no existe' });
        }
        
        // Insertar nodo
        const [result] = await pool.execute(`
            INSERT INTO nodos (descripcion, tipo, colmena_id)
            VALUES (?, ?, ?)
        `, [descripcion, tipo, colmena_id]);
        
        const nodoId = result.insertId;
        console.log(`✅ Nodo creado con ID: ${nodoId}`);
        
        res.status(201).json({ 
            message: 'Nodo creado exitosamente',
            id: nodoId
        });
    } catch (error) {
        handleError(res, error, 'Error al crear nodo');
    }
});

app.put('/api/nodos/:id', validateConnection, async (req, res) => {
    try {
        const { id } = req.params;
        const { descripcion, tipo, colmena_id } = req.body;
        
        // Validaciones
        if (!descripcion || !tipo || !colmena_id) {
            return res.status(400).json({ 
                error: 'Los campos descripcion, tipo y colmena_id son requeridos' 
            });
        }
        
        console.log(`✏️ Actualizando nodo: ${id}`);
        
        // Verificar que el nodo existe
        const [nodoCheck] = await pool.execute('SELECT id FROM nodos WHERE id = ?', [id]);
        if (nodoCheck.length === 0) {
            return res.status(404).json({ error: 'Nodo no encontrado' });
        }
        
        // Verificar que la colmena existe
        const [colmenaCheck] = await pool.execute('SELECT id FROM colmenas WHERE id = ?', [colmena_id]);
        if (colmenaCheck.length === 0) {
            return res.status(400).json({ error: 'La colmena especificada no existe' });
        }
        
        // Verificar que el tipo de nodo existe
        const [tipoCheck] = await pool.execute('SELECT tipo FROM tipos_nodo WHERE tipo = ?', [tipo]);
        if (tipoCheck.length === 0) {
            return res.status(400).json({ error: 'El tipo de nodo especificado no existe' });
        }
        
        await pool.execute(`
            UPDATE nodos 
            SET descripcion = ?, tipo = ?, colmena_id = ?
            WHERE id = ?
        `, [descripcion, tipo, colmena_id, id]);
        
        console.log(`✅ Nodo actualizado: ${id}`);
        res.json({ message: 'Nodo actualizado exitosamente' });
    } catch (error) {
        handleError(res, error, 'Error al actualizar nodo');
    }
});

app.delete('/api/nodos/:id', validateConnection, async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`🗑️ Eliminando nodo: ${id}`);
        
        // Verificar que el nodo existe
        const [nodoCheck] = await pool.execute('SELECT id FROM nodos WHERE id = ?', [id]);
        if (nodoCheck.length === 0) {
            return res.status(404).json({ error: 'Nodo no encontrado' });
        }
        
        // Verificar si tiene mensajes asociados
        const [mensajesCheck] = await pool.execute('SELECT COUNT(*) as count FROM mensajes WHERE nodo_id = ?', [id]);
        if (mensajesCheck[0].count > 0) {
            return res.status(409).json({ 
                error: 'No se puede eliminar el nodo porque tiene mensajes asociados' 
            });
        }
        
        await pool.execute('DELETE FROM nodos WHERE id = ?', [id]);
        
        console.log(`✅ Nodo eliminado: ${id}`);
        res.json({ message: 'Nodo eliminado exitosamente' });
    } catch (error) {
        handleError(res, error, 'Error al eliminar nodo');
    }
});

// ================================
// RUTAS DE TIPOS DE NODO
// ================================

app.get('/api/tipos-nodo', validateConnection, async (req, res) => {
    try {
        console.log('📊 Obteniendo tipos de nodo');
        const [rows] = await pool.execute('SELECT * FROM tipos_nodo ORDER BY descripcion');
        
        console.log(`✅ ${rows.length} tipos de nodo encontrados`);
        res.json(rows);
    } catch (error) {
        handleError(res, error, 'Error al obtener tipos de nodo');
    }
});

// ================================
// RUTAS DE MENSAJES
// ================================

app.get('/api/mensajes', validateConnection, async (req, res) => {
    try {
        const { limit = 100, offset = 0, nodo_id, topico } = req.query;
        
        console.log('📡 Obteniendo mensajes:', { limit, offset, nodo_id, topico });
        
        let query = `
            SELECT m.*, n.descripcion as nodo_descripcion, c.descripcion as colmena_descripcion
            FROM mensajes m
            LEFT JOIN nodos n ON m.nodo_id = n.id
            LEFT JOIN colmenas c ON n.colmena_id = c.id
            WHERE 1=1
        `;
        let params = [];
        
        if (nodo_id) {
            query += ' AND m.nodo_id = ?';
            params.push(nodo_id);
        }
        
        if (topico) {
            query += ' AND m.topico = ?';
            params.push(topico);
        }
        
        query += ' ORDER BY m.fecha DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        const [rows] = await pool.execute(query, params);
        
        console.log(`✅ ${rows.length} mensajes encontrados`);
        res.json(rows);
    } catch (error) {
        handleError(res, error, 'Error al obtener mensajes');
    }
});

app.get('/api/mensajes/recientes/:horas', validateConnection, async (req, res) => {
    try {
        const { horas } = req.params;
        const horasNum = parseInt(horas) || 24;
        
        console.log(`📡 Obteniendo mensajes de las últimas ${horasNum} horas`);
        
        const [rows] = await pool.execute(`
            SELECT m.*, n.descripcion as nodo_descripcion, c.descripcion as colmena_descripcion
            FROM mensajes m
            LEFT JOIN nodos n ON m.nodo_id = n.id
            LEFT JOIN colmenas c ON n.colmena_id = c.id
            WHERE m.fecha >= DATE_SUB(NOW(), INTERVAL ? HOUR)
            ORDER BY m.fecha DESC
        `, [horasNum]);
        
        console.log(`✅ ${rows.length} mensajes recientes encontrados`);
        res.json(rows);
    } catch (error) {
        handleError(res, error, 'Error al obtener mensajes recientes');
    }
});

app.post('/api/mensajes', validateConnection, async (req, res) => {
    try {
        const { nodo_id, topico, payload } = req.body;
        
        // Validaciones
        if (!nodo_id || !topico || payload === undefined) {
            return res.status(400).json({ 
                error: 'Los campos nodo_id, topico y payload son requeridos' 
            });
        }
        
        console.log('📡 Creando mensaje:', { nodo_id, topico, payload });
        
        // Verificar que el nodo existe
        const [nodoCheck] = await pool.execute('SELECT id FROM nodos WHERE id = ?', [nodo_id]);
        if (nodoCheck.length === 0) {
            return res.status(400).json({ error: 'El nodo especificado no existe' });
        }
        
        // Insertar mensaje
        const [result] = await pool.execute(`
            INSERT INTO mensajes (nodo_id, topico, payload, fecha)
            VALUES (?, ?, ?, NOW())
        `, [nodo_id, topico, payload]);
        
        const mensajeId = result.insertId;
        console.log(`✅ Mensaje creado con ID: ${mensajeId}`);
        
        res.status(201).json({ 
            message: 'Mensaje creado exitosamente',
            id: mensajeId
        });
    } catch (error) {
        handleError(res, error, 'Error al crear mensaje');
    }
});

app.get('/api/mensajes/:id', validateConnection, async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`📡 Obteniendo mensaje: ${id}`);
        
        const [rows] = await pool.execute(`
            SELECT m.*, n.descripcion as nodo_descripcion, c.descripcion as colmena_descripcion
            FROM mensajes m
            LEFT JOIN nodos n ON m.nodo_id = n.id
            LEFT JOIN colmenas c ON n.colmena_id = c.id
            WHERE m.id = ?
        `, [id]);
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Mensaje no encontrado' });
        }
        
        res.json(rows[0]);
    } catch (error) {
        handleError(res, error, 'Error al obtener mensaje');
    }
});

app.delete('/api/mensajes/:id', validateConnection, async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`🗑️ Eliminando mensaje: ${id}`);
        
        // Verificar que el mensaje existe
        const [mensajeCheck] = await pool.execute('SELECT id FROM mensajes WHERE id = ?', [id]);
        if (mensajeCheck.length === 0) {
            return res.status(404).json({ error: 'Mensaje no encontrado' });
        }
        
        await pool.execute('DELETE FROM mensajes WHERE id = ?', [id]);
        
        console.log(`✅ Mensaje eliminado: ${id}`);
        res.json({ message: 'Mensaje eliminado exitosamente' });
    } catch (error) {
        handleError(res, error, 'Error al eliminar mensaje');
    }
});

// Endpoint para limpiar mensajes antiguos
app.delete('/api/mensajes/cleanup/:dias', validateConnection, async (req, res) => {
    try {
        const { dias } = req.params;
        const diasNum = parseInt(dias) || 30;
        
        console.log(`🧹 Limpiando mensajes de más de ${diasNum} días`);
        
        const [result] = await pool.execute(`
            DELETE FROM mensajes 
            WHERE fecha < DATE_SUB(NOW(), INTERVAL ? DAY)
        `, [diasNum]);
        
        console.log(`✅ ${result.affectedRows} mensajes eliminados`);
        res.json({ 
            message: `${result.affectedRows} mensajes eliminados`,
            diasLimite: diasNum
        });
    } catch (error) {
        handleError(res, error, 'Error al limpiar mensajes antiguos');
    }
});

// ================================
// RUTAS DE AUTENTICACIÓN
// ================================

app.post('/api/auth/login', validateConnection, async (req, res) => {
    try {
        const { id, clave } = req.body;
        
        if (!id || !clave) {
            return res.status(400).json({ 
                error: 'ID de usuario y clave son requeridos' 
            });
        }
        
        console.log(`🔐 Intento de login: ${id}`);
        
        // Buscar usuario
        const [rows] = await pool.execute(`
            SELECT u.id, u.nombre, u.apellido, u.clave, u.rol, u.activo, r.descripcion as rol_descripcion
            FROM usuarios u
            LEFT JOIN roles r ON u.rol = r.rol
            WHERE u.id = ?
        `, [id]);
        
        if (rows.length === 0) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }
        
        const usuario = rows[0];
        
        // Verificar si el usuario está activo
        if (!usuario.activo) {
            return res.status(401).json({ error: 'Usuario inactivo' });
        }
        
        // Verificar clave
        const claveValida = await bcrypt.compare(clave, usuario.clave);
        if (!claveValida) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }
        
        // No devolver la clave en la respuesta
        delete usuario.clave;
        
        console.log(`✅ Login exitoso: ${id}`);
        res.json({
            message: 'Login exitoso',
            usuario: usuario
        });
    } catch (error) {
        handleError(res, error, 'Error en el proceso de autenticación');
    }
});

// ================================
// RUTAS DE ESTADÍSTICAS AVANZADAS
// ================================

app.get('/api/estadisticas/resumen', validateConnection, async (req, res) => {
    try {
        console.log('📊 Generando resumen de estadísticas');
        
        // Estadísticas generales
        const [statsGeneral] = await pool.execute(`
            SELECT 
                (SELECT COUNT(*) FROM colmenas) as total_colmenas,
                (SELECT COUNT(*) FROM colmenas WHERE activa = 1) as colmenas_activas,
                (SELECT COUNT(*) FROM usuarios) as total_usuarios,
                (SELECT COUNT(*) FROM usuarios WHERE activo = 1) as usuarios_activos,
                (SELECT COUNT(*) FROM nodos) as total_nodos,
                (SELECT COUNT(*) FROM mensajes WHERE fecha >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) as mensajes_hoy,
                (SELECT COUNT(*) FROM mensajes WHERE fecha >= DATE_SUB(NOW(), INTERVAL 7 DAY)) as mensajes_semana
        `);
        
        // Mensajes por tópico (últimos 7 días)
        const [mensajesPorTopico] = await pool.execute(`
            SELECT topico, COUNT(*) as cantidad
            FROM mensajes 
            WHERE fecha >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            GROUP BY topico
            ORDER BY cantidad DESC
        `);
        
        // Actividad por día (últimos 7 días)
        const [actividadDiaria] = await pool.execute(`
            SELECT 
                DATE(fecha) as fecha,
                COUNT(*) as mensajes
            FROM mensajes 
            WHERE fecha >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            GROUP BY DATE(fecha)
            ORDER BY fecha DESC
        `);
        
        // Colmenas más activas (por cantidad de mensajes)
        const [colmenasActivas] = await pool.execute(`
            SELECT 
                c.id,
                c.descripcion,
                COUNT(m.id) as total_mensajes,
                MAX(m.fecha) as ultimo_mensaje
            FROM colmenas c
            LEFT JOIN nodos n ON c.id = n.colmena_id
            LEFT JOIN mensajes m ON n.id = m.nodo_id
            WHERE m.fecha >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            GROUP BY c.id, c.descripcion
            ORDER BY total_mensajes DESC
            LIMIT 5
        `);
        
        const resumen = {
            general: statsGeneral[0],
            mensajesPorTopico: mensajesPorTopico,
            actividadDiaria: actividadDiaria,
            colmenasActivas: colmenasActivas
        };
        
        console.log('✅ Resumen de estadísticas generado');
        res.json(resumen);
    } catch (error) {
        handleError(res, error, 'Error al generar resumen de estadísticas');
    }
});

// ================================
// RUTAS PARA GESTIÓN DEL SISTEMA
// ================================

app.get('/api/sistema/info', validateConnection, async (req, res) => {
    try {
        console.log('ℹ️ Obteniendo información del sistema');
        
        // Información de la base de datos
        const [dbInfo] = await pool.execute('SELECT VERSION() as version');
        const [tableInfo] = await pool.execute(`
            SELECT 
                table_name,
                table_rows,
                data_length,
                index_length
            FROM information_schema.tables 
            WHERE table_schema = DATABASE()
            ORDER BY table_name
        `);
        
        const info = {
            api: {
                version: '1.0.0',
                nombre: 'SmartBee API',
                descripcion: 'API para gestión de colmenas inteligentes'
            },
            database: {
                version: dbInfo[0].version,
                tablas: tableInfo
            },
            servidor: {
                node_version: process.version,
                uptime: process.uptime(),
                memoria: process.memoryUsage(),
                timestamp: new Date().toISOString()
            }
        };
        
        console.log('✅ Información del sistema obtenida');
        res.json(info);
    } catch (error) {
        handleError(res, error, 'Error al obtener información del sistema');
    }
});

// Endpoint para ejecutar mantenimiento de la base de datos
app.post('/api/sistema/mantenimiento', validateConnection, async (req, res) => {
    try {
        console.log('🔧 Ejecutando tareas de mantenimiento');
        
        const resultados = [];
        
        // Optimizar tablas
        const tablas = ['usuarios', 'colmenas', 'nodos', 'mensajes', 'ubicaciones', 'roles', 'tipos_nodo'];
        
        for (const tabla of tablas) {
            try {
                await pool.execute(`OPTIMIZE TABLE ${tabla}`);
                resultados.push({ tabla, accion: 'optimizada', estado: 'exitoso' });
            } catch (err) {
                resultados.push({ tabla, accion: 'optimizada', estado: 'error', error: err.message });
            }
        }
        
        // Limpiar mensajes antiguos (más de 90 días)
        try {
            const [cleanupResult] = await pool.execute(`
                DELETE FROM mensajes 
                WHERE fecha < DATE_SUB(NOW(), INTERVAL 90 DAY)
            `);
            resultados.push({ 
                accion: 'limpieza_mensajes', 
                estado: 'exitoso',
                registros_eliminados: cleanupResult.affectedRows
            });
        } catch (err) {
            resultados.push({ 
                accion: 'limpieza_mensajes', 
                estado: 'error', 
                error: err.message 
            });
        }
        
        console.log('✅ Mantenimiento completado');
        res.json({
            message: 'Mantenimiento completado',
            resultados: resultados,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        handleError(res, error, 'Error durante el mantenimiento');
    }
});

// ================================
// RUTAS DE BACKUP Y EXPORTACIÓN
// ================================

app.get('/api/exportar/colmenas', validateConnection, async (req, res) => {
    try {
        console.log('📤 Exportando datos de colmenas');
        
        const [colmenas] = await pool.execute(`
            SELECT 
                c.id,
                c.descripcion,
                c.dueno,
                u.nombre as dueno_nombre,
                u.apellido as dueno_apellido,
                c.activa,
                ub.latitud,
                ub.longitud,
                ub.descripcion as ubicacion_descripcion,
                ub.comuna,
                (SELECT COUNT(*) FROM nodos WHERE colmena_id = c.id) as total_nodos,
                (SELECT COUNT(*) FROM mensajes m INNER JOIN nodos n ON m.nodo_id = n.id WHERE n.colmena_id = c.id) as total_mensajes
            FROM colmenas c
            LEFT JOIN usuarios u ON c.dueno = u.id
            LEFT JOIN ubicaciones ub ON c.id = ub.colmena_id
            ORDER BY c.id
        `);
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="colmenas_export_${new Date().toISOString().split('T')[0]}.json"`);
        
        console.log(`✅ Exportando ${colmenas.length} colmenas`);
        res.json({
            fecha_exportacion: new Date().toISOString(),
            total_registros: colmenas.length,
            colmenas: colmenas
        });
    } catch (error) {
        handleError(res, error, 'Error al exportar colmenas');
    }
});

app.get('/api/exportar/mensajes', validateConnection, async (req, res) => {
    try {
        const { dias = 30 } = req.query;
        console.log(`📤 Exportando mensajes de los últimos ${dias} días`);
        
        const [mensajes] = await pool.execute(`
            SELECT 
                m.id,
                m.nodo_id,
                n.descripcion as nodo_descripcion,
                c.id as colmena_id,
                c.descripcion as colmena_descripcion,
                m.topico,
                m.payload,
                m.fecha
            FROM mensajes m
            INNER JOIN nodos n ON m.nodo_id = n.id
            INNER JOIN colmenas c ON n.colmena_id = c.id
            WHERE m.fecha >= DATE_SUB(NOW(), INTERVAL ? DAY)
            ORDER BY m.fecha DESC
        `, [parseInt(dias)]);
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="mensajes_export_${dias}dias_${new Date().toISOString().split('T')[0]}.json"`);
        
        console.log(`✅ Exportando ${mensajes.length} mensajes`);
        res.json({
            fecha_exportacion: new Date().toISOString(),
            periodo_dias: parseInt(dias),
            total_registros: mensajes.length,
            mensajes: mensajes
        });
    } catch (error) {
        handleError(res, error, 'Error al exportar mensajes');
    }
});

// ================================
// MIDDLEWARE PARA RUTAS NO ENCONTRADAS
// ================================

app.use('*', (req, res) => {
    res.status(404).json({ 
        error: 'Endpoint no encontrado',
        path: req.originalUrl,
        method: req.method
    });
});

// ================================
// MIDDLEWARE GLOBAL DE MANEJO DE ERRORES
// ================================

app.use((err, req, res, next) => {
    console.error('❌ Error no manejado:', err);
    res.status(500).json({ 
        error: 'Error interno del servidor',
        message: err.message,
        timestamp: new Date().toISOString()
    });
});

// ================================
// INICIALIZACIÓN DEL SERVIDOR
// ================================

const startServer = async () => {
    try {
        // Verificar conexión a la base de datos
        console.log('🔌 Verificando conexión a la base de datos...');
        await pool.execute('SELECT 1');
        console.log('✅ Conexión a la base de datos establecida');
        
        // Iniciar servidor
        app.listen(PORT, () => {
            console.log(`🚀 SmartBee API v1.0 ejecutándose en puerto ${PORT}`);
            console.log(`📊 Dashboard: http://localhost:${PORT}/health`);
            console.log(`🐝 Endpoints disponibles:`);
            console.log(`   • GET  /api/dashboard/stats`);
            console.log(`   • GET  /api/usuarios`);
            console.log(`   • GET  /api/colmenas`);
            console.log(`   • GET  /api/nodos`);
            console.log(`   • GET  /api/mensajes`);
            console.log(`   • GET  /api/roles`);
            console.log(`   • GET  /api/tipos-nodo`);
            console.log(`   • POST /api/auth/login`);
            console.log(`   • GET  /api/estadisticas/resumen`);
            console.log(`   • GET  /health`);
            console.log('📡 API lista para recibir peticiones');
        });
    } catch (error) {
        console.error('❌ Error al iniciar el servidor:', error);
        process.exit(1);
    }
};

// Manejo graceful de cierre del servidor
process.on('SIGTERM', async () => {
    console.log('🔄 Cerrando servidor gracefully...');
    await pool.end();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🔄 Cerrando servidor gracefully...');
    await pool.end();
    process.exit(0);
});

// Iniciar el servidor
startServer();
