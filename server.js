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

// ✅ CORREGIDO: CORS más permisivo para Railway
app.use(cors({
  origin: [
    'https://datos-github-io-gamma.vercel.app',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:8080',
    /\.railway\.app$/,
    /\.up\.railway\.app$/
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

// ✅ NUEVO: Ruta raíz para Railway
app.get('/', (req, res) => {
    res.json({ 
        message: 'SmartBee API - Railway Deployment',
        status: 'online',
        timestamp: new Date().toISOString(),
        endpoints: {
            health: '/api/health',
            testDb: '/api/test-db',
            usuarios: '/api/usuarios',
            colmenas: '/api/colmenas',
            dashboard: '/api/dashboard/stats'
        }
    });
});

app.get('/api/health', (req, res) => {
    res.json({ 
        message: 'SmartBee API funcionando correctamente',
        timestamp: new Date().toISOString(),
        database: 'Railway MySQL',
        environment: process.env.NODE_ENV || 'development',
        port: PORT
    });
});

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

// =============================================
// RUTAS DE AUTENTICACIÓN
// =============================================

app.post('/api/usuarios/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        console.log('🔐 Login attempt:', { email });
        
        if (!email || !password) {
            return res.status(400).json({ 
                error: 'Email y contraseña son requeridos' 
            });
        }
        
        // Buscar usuario por nombre (ya que no tienes campo email en tu esquema)
        const [rows] = await pool.execute(`
            SELECT u.id, u.clave, u.nombre, u.apellido, u.rol, r.descripcion as rol_descripcion
            FROM usuario u
            LEFT JOIN rol r ON u.rol = r.rol
            WHERE u.nombre = ?
        `, [email]);
        
        if (rows.length === 0) {
            return res.status(401).json({ 
                error: 'Credenciales inválidas' 
            });
        }
        
        const usuario = rows[0];
        
        // Verificar contraseña (en tu esquema están en texto plano)
        const validPassword = (usuario.clave === password);
        
        if (!validPassword) {
            return res.status(401).json({ 
                error: 'Credenciales inválidas' 
            });
        }
        
        console.log('✅ Login exitoso:', { id: usuario.id, nombre: usuario.nombre });
        
        const token = `smartbee_${usuario.id}_${Date.now()}`;
        
        res.json({
            data: {
                token: token,
                usuario: {
                    id: usuario.id,
                    nombre: usuario.nombre,
                    apellido: usuario.apellido,
                    email: usuario.nombre, // Usar nombre como email
                    rol_nombre: usuario.rol_descripcion || 'Usuario'
                }
            },
            message: 'Login exitoso'
        });
        
    } catch (error) {
        console.error('💥 Error en login:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor'
        });
    }
});

// =============================================
// RUTAS PARA USUARIOS
// =============================================

app.get('/api/usuarios', async (req, res) => {
    try {
        console.log('📋 Obteniendo usuarios...');
        
        const [rows] = await pool.execute(`
            SELECT u.id, u.nombre, u.apellido, u.clave, u.rol,
                   r.descripcion as rol_nombre
            FROM usuario u 
            LEFT JOIN rol r ON u.rol = r.rol 
            ORDER BY u.id ASC
        `);
        
        // CORREGIDO: Ahora incluimos tanto el rol (ID) como el rol_nombre
        const usuarios = rows.map(user => ({
            id: user.id,
            nombre: user.nombre,
            apellido: user.apellido,
            email: user.nombre, // Usar nombre como email temporalmente
            telefono: '', // No existe en tu esquema
            fecha_registro: new Date().toISOString(), // Temporalmente
            rol: user.rol, // ✅ AGREGADO: ID del rol (1, 2, 3)
            rol_nombre: user.rol_nombre || 'Usuario' // ✅ MANTENIDO: Nombre del rol
        }));
        
        console.log('✅ Usuarios obtenidos:', usuarios.length);
        res.json(usuarios);
    } catch (error) {
        console.error('💥 Error obteniendo usuarios:', error);
        res.status(500).json({ error: 'Error obteniendo usuarios' });
    }
});

app.post('/api/usuarios', async (req, res) => {
    try {
        console.log('📝 Creando usuario con datos:', req.body);
        
        // Extraer campos del frontend y mapear a tu esquema
        const { 
            nombre, 
            apellido, 
            email,        // El frontend envía email, pero usamos como nombre si no hay nombre
            password,     // El frontend envía password, mapeamos a clave
            clave,        // O puede enviar clave directamente
            rol = 2       // Por defecto rol 2 (Apicultor)
        } = req.body;
        
        // Determinar valores finales
        const nombreFinal = nombre || email || 'Usuario';
        const apellidoFinal = apellido || 'Apellido';
        const claveFinal = clave || password || '1234';
        
        console.log('📝 Datos procesados:', {
            nombre: nombreFinal,
            apellido: apellidoFinal,
            clave: claveFinal,
            rol: rol
        });
        
        // Validar campos requeridos
        if (!nombreFinal || !apellidoFinal || !claveFinal) {
            return res.status(400).json({ 
                error: 'Nombre, apellido y contraseña son obligatorios',
                received: req.body
            });
        }
        
        // Verificar que el rol existe
        const [rolExists] = await pool.execute('SELECT rol FROM rol WHERE rol = ?', [rol]);
        if (rolExists.length === 0) {
            console.log('⚠️ Rol no existe, usando rol 2 por defecto');
            rol = 2;
        }
        
        // Insertar usuario
        const [result] = await pool.execute(`
            INSERT INTO usuario (nombre, apellido, clave, rol) 
            VALUES (?, ?, ?, ?)
        `, [nombreFinal, apellidoFinal, claveFinal, rol]);
        
        console.log('✅ Usuario creado exitosamente:', result.insertId);
        
        // Obtener el usuario creado para devolverlo
        const [newUser] = await pool.execute(`
            SELECT u.id, u.nombre, u.apellido, u.rol,
                   r.descripcion as rol_nombre
            FROM usuario u
            LEFT JOIN rol r ON u.rol = r.rol
            WHERE u.id = ?
        `, [result.insertId]);
        
        res.status(201).json({ 
            id: result.insertId,
            message: 'Usuario creado exitosamente',
            usuario: {
                id: newUser[0].id,
                nombre: newUser[0].nombre,
                apellido: newUser[0].apellido,
                email: newUser[0].nombre, // Mapear nombre a email para frontend
                telefono: '', // No existe en tu esquema
                fecha_registro: new Date().toISOString(),
                rol_nombre: newUser[0].rol_nombre || 'Usuario'
            }
        });
        
    } catch (error) {
        console.error('💥 Error creando usuario:', error);
        
        // Log detallado del error
        console.error('Error details:', {
            message: error.message,
            code: error.code,
            errno: error.errno,
            sql: error.sql
        });
        
        res.status(500).json({ 
            error: 'Error creando usuario',
            details: process.env.NODE_ENV === 'development' ? error.message : 'Error interno'
        });
    }
});

app.put('/api/usuarios/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, apellido, clave, rol } = req.body;
        
        console.log(`✏️ Actualizando usuario ${id}:`, req.body);
        
        // Verificar que el usuario existe
        const [userExists] = await pool.execute('SELECT id FROM usuario WHERE id = ?', [id]);
        if (userExists.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        // Validar campos requeridos
        if (!nombre || !apellido || !rol) {
            return res.status(400).json({ 
                error: 'Nombre, apellido y rol son obligatorios' 
            });
        }
        
        // Verificar que el rol existe
        const [rolExists] = await pool.execute('SELECT rol FROM rol WHERE rol = ?', [rol]);
        if (rolExists.length === 0) {
            return res.status(400).json({ error: 'El rol especificado no existe' });
        }
        
        // Preparar la consulta de actualización
        let updateQuery;
        let updateParams;
        
        if (clave && clave.trim()) {
            // Actualizar con nueva clave
            updateQuery = `
                UPDATE usuario 
                SET nombre = ?, apellido = ?, clave = ?, rol = ?
                WHERE id = ?
            `;
            updateParams = [nombre.trim(), apellido.trim(), clave.trim(), parseInt(rol), id];
        } else {
            // Actualizar sin cambiar la clave
            updateQuery = `
                UPDATE usuario 
                SET nombre = ?, apellido = ?, rol = ?
                WHERE id = ?
            `;
            updateParams = [nombre.trim(), apellido.trim(), parseInt(rol), id];
        }
        
        // Ejecutar actualización
        await pool.execute(updateQuery, updateParams);
        
        console.log('✅ Usuario actualizado:', id);
        
        // Obtener el usuario actualizado para devolverlo
        const [updatedUser] = await pool.execute(`
            SELECT u.id, u.nombre, u.apellido, u.rol,
                   r.descripcion as rol_nombre
            FROM usuario u
            LEFT JOIN rol r ON u.rol = r.rol
            WHERE u.id = ?
        `, [id]);
        
        res.json({ 
            message: 'Usuario actualizado correctamente',
            usuario: {
                id: updatedUser[0].id,
                nombre: updatedUser[0].nombre,
                apellido: updatedUser[0].apellido,
                email: updatedUser[0].nombre, // Mapear nombre a email para frontend
                telefono: '', // No existe en tu esquema
                fecha_registro: new Date().toISOString(),
                rol_nombre: updatedUser[0].rol_nombre || 'Usuario',
                rol: updatedUser[0].rol
            }
        });
        
    } catch (error) {
        console.error('💥 Error actualizando usuario:', error);
        res.status(500).json({ 
            error: 'Error actualizando usuario',
            details: process.env.NODE_ENV === 'development' ? error.message : 'Error interno'
        });
    }
});

// DELETE - Eliminar usuario
app.delete('/api/usuarios/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        console.log(`🗑️ Eliminando usuario ${id}`);
        
        // Verificar que el usuario existe
        const [userExists] = await pool.execute('SELECT id, nombre, apellido FROM usuario WHERE id = ?', [id]);
        if (userExists.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        const usuario = userExists[0];
        
        // Verificar si el usuario tiene colmenas asociadas
        const [colmenasAsociadas] = await pool.execute('SELECT COUNT(*) as count FROM colmena WHERE dueno = ?', [id]);
        
        if (colmenasAsociadas[0].count > 0) {
            return res.status(400).json({ 
                error: `No se puede eliminar el usuario porque tiene ${colmenasAsociadas[0].count} colmena(s) asociada(s). Primero transfiere o elimina las colmenas.`
            });
        }
        
        // Eliminar usuario
        await pool.execute('DELETE FROM usuario WHERE id = ?', [id]);
        
        console.log('✅ Usuario eliminado:', id);
        res.json({ 
            message: `Usuario "${usuario.nombre} ${usuario.apellido}" eliminado correctamente`,
            id: parseInt(id)
        });
        
    } catch (error) {
        console.error('💥 Error eliminando usuario:', error);
        
        // Error específico para foreign key constraint
        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(400).json({ 
                error: 'No se puede eliminar el usuario porque tiene registros asociados (colmenas, etc.)'
            });
        }
        
        res.status(500).json({ 
            error: 'Error eliminando usuario',
            details: process.env.NODE_ENV === 'development' ? error.message : 'Error interno'
        });
    }
});

// GET - Obtener un usuario específico (opcional, útil para debug)
app.get('/api/usuarios/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        console.log(`🔍 Obteniendo usuario ${id}`);
        
        const [rows] = await pool.execute(`
            SELECT u.id, u.nombre, u.apellido, u.clave, u.rol,
                   r.descripcion as rol_nombre
            FROM usuario u 
            LEFT JOIN rol r ON u.rol = r.rol 
            WHERE u.id = ?
        `, [id]);
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        const usuario = {
            id: rows[0].id,
            nombre: rows[0].nombre,
            apellido: rows[0].apellido,
            email: rows[0].nombre, // Usar nombre como email temporalmente
            telefono: '', // No existe en tu esquema
            fecha_registro: new Date().toISOString(), // Temporalmente
            rol_nombre: rows[0].rol_nombre || 'Usuario',
            rol: rows[0].rol
        };
        
        console.log('✅ Usuario obtenido:', usuario);
        res.json(usuario);
        
    } catch (error) {
        console.error('💥 Error obteniendo usuario:', error);
        res.status(500).json({ error: 'Error obteniendo usuario' });
    }
});

// =============================================
// RUTAS PARA COLMENAS
// =============================================

app.get('/api/colmenas', async (req, res) => {
    try {
        console.log('🏠 Obteniendo colmenas...');
        
        const [rows] = await pool.execute(`
            SELECT c.id, c.descripcion, c.dueno,
                   u.nombre as dueno_nombre, u.apellido as dueno_apellido,
                   cu.latitud, cu.longitud, cu.comuna, cu.descripcion as ubicacion_descripcion
            FROM colmena c
            LEFT JOIN usuario u ON c.dueno = u.id
            LEFT JOIN colmena_ubicacion cu ON c.id = cu.colmena_id
            ORDER BY c.id ASC
        `);
        
        // Formatear para compatibilidad con frontend
        const colmenas = rows.map(colmena => ({
            id: colmena.id,
            nombre: `Colmena #${colmena.id}`, // Generar nombre basado en ID
            tipo: 'Langstroth', // Valor por defecto
            descripcion: colmena.descripcion,
            dueno: colmena.dueno,
            dueno_nombre: colmena.dueno_nombre,
            dueno_apellido: colmena.dueno_apellido,
            apiario_id: null, // No existe en tu esquema
            apiario_nombre: colmena.comuna, // Usar comuna como "apiario"
            fecha_instalacion: new Date().toISOString(), // Temporalmente
            activa: 1, // Asumir que están activas
            latitud: colmena.latitud,
            longitud: colmena.longitud,
            ubicacion: colmena.ubicacion_descripcion,
            comuna: colmena.comuna,
            ubicacion_descripcion: colmena.ubicacion_descripcion
        }));
        
        console.log('✅ Colmenas obtenidas:', colmenas.length);
        res.json(colmenas);
    } catch (error) {
        console.error('💥 Error obteniendo colmenas:', error);
        res.status(500).json({ error: 'Error obteniendo colmenas' });
    }
});

// POST - Crear nueva colmena
app.post('/api/colmenas', async (req, res) => {
    try {
        console.log('➕ Creando nueva colmena con datos:', req.body);
        
        const { descripcion, dueno } = req.body;
        
        // Validar campos requeridos
        if (!descripcion || !dueno) {
            return res.status(400).json({ 
                error: 'Descripción y dueño son obligatorios' 
            });
        }
        
        // Verificar que el dueño existe
        const [duenoExists] = await pool.execute('SELECT id FROM usuario WHERE id = ?', [dueno]);
        if (duenoExists.length === 0) {
            return res.status(400).json({ error: 'El usuario dueño no existe' });
        }
        
        // Insertar nueva colmena
        const [result] = await pool.execute(`
            INSERT INTO colmena (descripcion, dueno) 
            VALUES (?, ?)
        `, [descripcion.trim(), parseInt(dueno)]);
        
        console.log('✅ Colmena creada exitosamente:', result.insertId);
        
        // Devolver la colmena creada con formato completo
        const nuevaColmena = {
            id: result.insertId,
            descripcion: descripcion.trim(),
            dueno: parseInt(dueno),
            message: 'Colmena creada exitosamente'
        };
        
        res.status(201).json(nuevaColmena);
        
    } catch (error) {
        console.error('💥 Error creando colmena:', error);
        res.status(500).json({ 
            error: 'Error creando colmena',
            details: error.message 
        });
    }
});

// GET - Obtener detalle completo de una colmena
app.get('/api/colmenas/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        console.log(`🔍 Obteniendo detalle de colmena ${id}`);
        
        // Obtener información básica de la colmena
        const [colmenaData] = await pool.execute(`
            SELECT c.id, c.descripcion, c.dueno,
                   u.nombre as dueno_nombre, u.apellido as dueno_apellido
            FROM colmena c
            LEFT JOIN usuario u ON c.dueno = u.id
            WHERE c.id = ?
        `, [id]);
        
        if (colmenaData.length === 0) {
            return res.status(404).json({ error: 'Colmena no encontrada' });
        }
        
        // Obtener ubicación
        const [ubicacionData] = await pool.execute(`
            SELECT latitud, longitud, descripcion as ubicacion_descripcion, comuna
            FROM colmena_ubicacion 
            WHERE colmena_id = ?
            ORDER BY fecha DESC
            LIMIT 1
        `, [id]);
        
        // Obtener nodos asociados
        const [nodosData] = await pool.execute(`
            SELECT n.id, n.descripcion, n.tipo,
                   nt.descripcion as tipo_descripcion
            FROM nodo_colmena nc
            JOIN nodo n ON nc.nodo_id = n.id
            LEFT JOIN nodo_tipo nt ON n.tipo = nt.tipo
            WHERE nc.colmena_id = ?
        `, [id]);
        
        const colmenaCompleta = {
            ...colmenaData[0],
            ...(ubicacionData[0] || {}),
            nodos: nodosData
        };
        
        console.log('✅ Detalle de colmena obtenido:', colmenaCompleta);
        res.json(colmenaCompleta);
        
    } catch (error) {
        console.error('💥 Error obteniendo detalle de colmena:', error);
        res.status(500).json({ error: 'Error obteniendo detalle de colmena' });
    }
});

// PUT - Actualizar colmena
app.put('/api/colmenas/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { descripcion, dueno } = req.body;
        
        console.log(`✏️ Actualizando colmena ${id}:`, req.body);
        
        // Verificar que la colmena existe
        const [colmenaExists] = await pool.execute('SELECT id FROM colmena WHERE id = ?', [id]);
        if (colmenaExists.length === 0) {
            return res.status(404).json({ error: 'Colmena no encontrada' });
        }
        
        // Actualizar colmena
        await pool.execute(`
            UPDATE colmena 
            SET descripcion = ?, dueno = ?
            WHERE id = ?
        `, [descripcion, dueno, id]);
        
        console.log('✅ Colmena actualizada:', id);
        res.json({ 
            message: 'Colmena actualizada correctamente',
            id: parseInt(id)
        });
        
    } catch (error) {
        console.error('💥 Error actualizando colmena:', error);
        res.status(500).json({ error: 'Error actualizando colmena' });
    }
});

// DELETE - Eliminar colmena
app.delete('/api/colmenas/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        console.log(`🗑️ Eliminando colmena ${id}`);
        
        // Verificar que la colmena existe
        const [colmenaExists] = await pool.execute('SELECT id FROM colmena WHERE id = ?', [id]);
        if (colmenaExists.length === 0) {
            return res.status(404).json({ error: 'Colmena no encontrada' });
        }
        
        // Eliminar en orden (por las foreign keys)
        await pool.execute('DELETE FROM nodo_colmena WHERE colmena_id = ?', [id]);
        await pool.execute('DELETE FROM colmena_ubicacion WHERE colmena_id = ?', [id]);
        await pool.execute('DELETE FROM colmena WHERE id = ?', [id]);
        
        console.log('✅ Colmena eliminada:', id);
        res.json({ 
            message: 'Colmena eliminada correctamente',
            id: parseInt(id)
        });
        
    } catch (error) {
        console.error('💥 Error eliminando colmena:', error);
        res.status(500).json({ error: 'Error eliminando colmena' });
    }
});

app.post('/api/colmenas/:id/ubicaciones', async (req, res) => {
    try {
        const { id } = req.params;
        const { latitud, longitud, descripcion, comuna } = req.body;
        
        console.log(`📍 Agregando ubicación a colmena ${id}:`, req.body);
        
        // Verificar que la colmena existe
        const [colmenaExists] = await pool.execute('SELECT id FROM colmena WHERE id = ?', [id]);
        if (colmenaExists.length === 0) {
            return res.status(404).json({ error: 'Colmena no encontrada' });
        }
        
        // Validar campos requeridos
        if (!latitud || !longitud) {
            return res.status(400).json({ error: 'Latitud y longitud son requeridos' });
        }
        
        // Verificar si ya existe una ubicación para esta colmena
        const [existingLocation] = await pool.execute(
            'SELECT id FROM colmena_ubicacion WHERE colmena_id = ?', 
            [id]
        );
        
        if (existingLocation.length > 0) {
            // Actualizar ubicación existente
            await pool.execute(`
                UPDATE colmena_ubicacion 
                SET latitud = ?, longitud = ?, descripcion = ?, comuna = ?, fecha = CURRENT_TIMESTAMP
                WHERE colmena_id = ?
            `, [latitud, longitud, descripcion || null, comuna || null, id]);
            
            console.log('✅ Ubicación actualizada para colmena:', id);
        } else {
            // Crear nueva ubicación
            await pool.execute(`
                INSERT INTO colmena_ubicacion (colmena_id, latitud, longitud, descripcion, comuna) 
                VALUES (?, ?, ?, ?, ?)
            `, [id, latitud, longitud, descripcion || null, comuna || null]);
            
            console.log('✅ Nueva ubicación creada para colmena:', id);
        }
        
        res.json({ 
            message: 'Ubicación agregada/actualizada correctamente',
            colmena_id: id
        });
        
    } catch (error) {
        console.error('💥 Error agregando ubicación:', error);
        res.status(500).json({ 
            error: 'Error agregando ubicación',
            details: error.message 
        });
    }
});

// GET - Obtener nodos asociados a una colmena específica
app.get('/api/colmenas/:id/nodos', async (req, res) => {
    try {
        const { id } = req.params;
        
        console.log(`🔌 Obteniendo nodos para colmena ${id}`);
        
        // Verificar que la colmena existe
        const [colmenaExists] = await pool.execute('SELECT id FROM colmena WHERE id = ?', [id]);
        if (colmenaExists.length === 0) {
            return res.status(404).json({ error: 'Colmena no encontrada' });
        }
        
        // Obtener nodos asociados a esta colmena
        const [nodos] = await pool.execute(`
            SELECT n.id, n.descripcion, n.tipo,
                   nt.descripcion as tipo_descripcion,
                   nc.fecha as fecha_asociacion
            FROM nodo_colmena nc
            JOIN nodo n ON nc.nodo_id = n.id
            LEFT JOIN nodo_tipo nt ON n.tipo = nt.tipo
            WHERE nc.colmena_id = ?
            ORDER BY nc.fecha DESC
        `, [id]);
        
        console.log(`✅ Nodos encontrados para colmena ${id}:`, nodos.length);
        res.json(nodos);
        
    } catch (error) {
        console.error('💥 Error obteniendo nodos de colmena:', error);
        res.status(500).json({ 
            error: 'Error obteniendo nodos de la colmena',
            details: error.message 
        });
    }
});

// GET - Obtener ubicaciones específicas de una colmena
app.get('/api/colmenas/:id/ubicaciones', async (req, res) => {
    try {
        const { id } = req.params;
        
        console.log(`📍 Obteniendo ubicaciones para colmena ${id}`);
        
        const [ubicaciones] = await pool.execute(`
            SELECT id, latitud, longitud, descripcion, comuna, fecha
            FROM colmena_ubicacion 
            WHERE colmena_id = ?
            ORDER BY fecha DESC
        `, [id]);
        
        console.log(`✅ Ubicaciones encontradas para colmena ${id}:`, ubicaciones.length);
        res.json(ubicaciones);
        
    } catch (error) {
        console.error('💥 Error obteniendo ubicaciones:', error);
        res.status(500).json({ 
            error: 'Error obteniendo ubicaciones',
            details: error.message 
        });
    }
});

//
