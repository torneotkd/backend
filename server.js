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
        'https://abeja-mu.vercel.app/',
        'http://localhost:3000',
        'http://localhost:5173',
        'http://localhost:8080'
    ],
    credentials: true
    }));

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Middleware de logging mejorado
    app.use((req, res, next) => {
        console.log(`\n🔄 ${new Date().toISOString()} - ${req.method} ${req.path}`);
        if (req.method === 'POST' || req.method === 'PUT') {
            console.log('📝 Body:', JSON.stringify(req.body, null, 2));
        }
        if (Object.keys(req.query).length > 0) {
            console.log('🔍 Query:', JSON.stringify(req.query, null, 2));
        }
        next();
    });

    // Wrapper para manejar errores de base de datos
    const safeDbQuery = async (queryFn, fallbackValue = []) => {
        try {
            return await queryFn();
        } catch (error) {
            console.error('💥 Database Error:', {
                message: error.message,
                code: error.code,
                errno: error.errno,
                sql: error.sql
            });
            return fallbackValue;
        }
    };

    // =============================================
    // RUTAS BÁSICAS Y DE DEBUG
    // =============================================

    app.get('/api/health', (req, res) => {
        res.json({ 
            message: 'SmartBee API funcionando correctamente',
            timestamp: new Date().toISOString(),
            database: 'Railway MySQL'
        });
    });

    app.get('/api/test-db', async (req, res) => {
        let connection;
        try {
            connection = await pool.getConnection();
            const [rows] = await connection.execute('SELECT 1 as test, NOW() as timestamp');
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
        } finally {
            if (connection) connection.release();
        }
    });

    app.get('/api/debug/check-tables', async (req, res) => {
        let connection;
        try {
            connection = await pool.getConnection();
            
            // Verificar qué tablas existen
            const [tables] = await connection.execute(`
                SELECT TABLE_NAME 
                FROM information_schema.TABLES 
                WHERE TABLE_SCHEMA = DATABASE()
                ORDER BY TABLE_NAME
            `);
            
            const tableNames = tables.map(t => t.TABLE_NAME);
            
            // Verificar estructura de tablas principales
            const tableInfo = {};
            
            for (const tableName of ['usuario', 'rol', 'colmena', 'colmena_ubicacion', 'mensaje', 'nodo', 'nodo_tipo']) {
                if (tableNames.includes(tableName)) {
                    try {
                        const [columns] = await connection.execute(`DESCRIBE ${tableName}`);
                        const [count] = await connection.execute(`SELECT COUNT(*) as count FROM ${tableName}`);
                        
                        tableInfo[tableName] = {
                            exists: true,
                            columns: columns.map(c => ({ field: c.Field, type: c.Type, key: c.Key })),
                            rowCount: count[0].count
                        };
                    } catch (e) {
                        tableInfo[tableName] = {
                            exists: false,
                            error: e.message
                        };
                    }
                } else {
                    tableInfo[tableName] = {
                        exists: false,
                        error: 'Tabla no encontrada'
                    };
                }
            }
            
            res.json({
                database: 'Connected',
                allTables: tableNames,
                requiredTables: tableInfo
            });
            
        } catch (error) {
            console.error('Error checking database structure:', error);
            res.status(500).json({ 
                error: 'Error checking database structure',
                details: error.message 
            });
        } finally {
            if (connection) connection.release();
        }
    });

    app.get('/api/test-connection', async (req, res) => {
        let connection;
        try {
            console.log('🔗 Probando conexión...');
            connection = await pool.getConnection();
            console.log('✅ Conexión obtenida');
            
            const [result] = await connection.execute('SELECT 1 as test, NOW() as time');
            console.log('✅ Query ejecutada:', result[0]);
            
            res.json({ 
                success: true, 
                result: result[0],
                message: 'Conexión exitosa'
            });
            
        } catch (error) {
            console.error('💥 Error de conexión:', error);
            res.status(500).json({ 
                success: false, 
                error: error.message,
                code: error.code 
            });
        } finally {
            if (connection) {
                connection.release();
                console.log('🔓 Conexión liberada');
            }
        }
    });

    // =============================================
    // RUTAS DE AUTENTICACIÓN
    // =============================================

    app.post('/api/usuarios/login', async (req, res) => {
        let connection;
        try {
            const { email, password, nombre, apellido } = req.body;
            
            console.log('🔐 Login attempt con datos:', { email, nombre, apellido });
            
            // Validar que se proporcionen las credenciales necesarias
            if (!password || password.trim() === '') {
                return res.status(400).json({ 
                    error: 'La contraseña es requerida' 
                });
            }

            // Aceptar tanto email (ID) como nombre+apellido
            let usuario = null;
            connection = await pool.getConnection();

            if (email && email.trim()) {
                // Buscar por ID (modo original)
                console.log('🔍 Buscando usuario por ID:', email);
                const [rows] = await connection.execute(`
                    SELECT u.id, u.clave, u.nombre, u.apellido, u.comuna, u.rol, u.activo,
                        r.descripcion as rol_descripcion
                    FROM usuario u
                    LEFT JOIN rol r ON u.rol = r.rol
                    WHERE u.id = ? AND u.activo = 1
                `, [email.trim()]);
                
                if (rows.length > 0) {
                    usuario = rows[0];
                    console.log('✅ Usuario encontrado por ID');
                }
            }

            // Si no se encontró por ID, buscar por nombre y apellido
            if (!usuario && nombre && apellido) {
                console.log('🔍 Buscando usuario por nombre y apellido:', { nombre, apellido });
                const [rows] = await connection.execute(`
                    SELECT u.id, u.clave, u.nombre, u.apellido, u.comuna, u.rol, u.activo,
                        r.descripcion as rol_descripcion
                    FROM usuario u
                    LEFT JOIN rol r ON u.rol = r.rol
                    WHERE LOWER(u.nombre) = LOWER(?) AND LOWER(u.apellido) = LOWER(?) AND u.activo = 1
                `, [nombre.trim(), apellido.trim()]);
                
                if (rows.length > 0) {
                    usuario = rows[0];
                    console.log('✅ Usuario encontrado por nombre y apellido');
                }
            }

            // Si aún no se encontró usuario
            if (!usuario) {
                console.log('❌ Usuario no encontrado con las credenciales proporcionadas');
                return res.status(401).json({ 
                    error: 'Credenciales inválidas. Verifique su nombre, apellido y contraseña.' 
                });
            }
            
            // Verificar contraseña
            let validPassword = false;

            if (usuario.clave.startsWith('$2a$') || usuario.clave.startsWith('$2b$')) {
                // Contraseña hasheada con bcrypt
                validPassword = await bcrypt.compare(password, usuario.clave);
            } else {
                // Contraseña en texto plano (fallback)
                validPassword = (usuario.clave === password);
            }
            
            if (!validPassword) {
                console.log('❌ Contraseña inválida para usuario:', usuario.id);
                return res.status(401).json({ 
                    error: 'Credenciales inválidas. Verifique su contraseña.' 
                });
            }
            
            console.log('✅ Login exitoso:', { 
                id: usuario.id, 
                nombre: usuario.nombre, 
                apellido: usuario.apellido,
                rol: usuario.rol,
                rol_descripcion: usuario.rol_descripcion
            });
            
            const token = `smartbee_${usuario.id}_${Date.now()}`;
            
            res.json({
                data: {
                    token: token,
                    usuario: {
                        id: usuario.id,
                        nombre: usuario.nombre,
                        apellido: usuario.apellido,
                        email: usuario.id, // Mantener compatibilidad
                        comuna: usuario.comuna,
                        rol: usuario.rol, // Código del rol (ADM, API, etc.)
                        rol_nombre: usuario.rol_descripcion || 'Usuario' // Descripción del rol
                    }
                },
                message: 'Login exitoso'
            });
            
        } catch (error) {
            console.error('💥 Error en login:', error);
            res.status(500).json({ 
                error: 'Error interno del servidor'
            });
        } finally {
            if (connection) connection.release();
        }
    });


    // =============================================
    // RUTAS PARA USUARIOS - ACTUALIZADAS PARA INCLUIR COMUNA
    // =============================================

    app.get('/api/usuarios', async (req, res) => {
        let connection;
        try {
            console.log('📋 Obteniendo usuarios...');
            
            connection = await pool.getConnection();
            
            const [rows] = await connection.execute(`
            SELECT u.id, u.nombre, u.apellido, u.comuna, u.clave, u.rol, u.activo,
                r.descripcion as rol_nombre
            FROM usuario u 
            LEFT JOIN rol r ON u.rol = r.rol 
            WHERE u.activo = 1
            ORDER BY u.id ASC
        `);
            
            const usuarios = rows.map(user => ({
                id: user.id,
                nombre: user.nombre,
                apellido: user.apellido,
                comuna: user.comuna, // NUEVO CAMPO
                email: user.id,
                telefono: '',
                fecha_registro: new Date().toISOString(),
                rol: user.rol,
                rol_nombre: user.rol_nombre || 'Usuario',
                activo: user.activo
            }));
            
            console.log('✅ Usuarios obtenidos:', usuarios.length);
            res.json(usuarios);
        } catch (error) {
            console.error('💥 Error obteniendo usuarios:', error);
            res.status(500).json({ 
                error: 'Error obteniendo usuarios',
                details: error.message 
            });
        } finally {
            if (connection) connection.release();
        }
    });

    // =============================================
    // CREAR USUARIO ACTUALIZADO CON COMUNA
    // =============================================

    app.post('/api/usuarios', async (req, res) => {
        let connection;
        try {
            console.log('\n🔥 CREANDO USUARIO...');
            console.log('📋 Body RAW:', req.body);
            
            connection = await pool.getConnection();
            console.log('✅ Conexión obtenida');
            
            // Extract data including new comuna field
            const { id, nombre, apellido, comuna, clave, rol, activo } = req.body;
            console.log('📝 Datos extraídos:', { 
                id: `"${id}"`, 
                nombre: `"${nombre}"`, 
                apellido: `"${apellido}"`, 
                comuna: `"${comuna}"`,
                clave: clave ? `"${clave}"` : '[FALTANTE]', 
                rol: `"${rol}"`,
                activo: activo
            });
            
            // VALIDACIONES ACTUALIZADAS
            if (!nombre || nombre.trim() === '') {
                console.log('❌ Nombre faltante o vacío');
                return res.status(400).json({ 
                    error: 'El nombre es obligatorio' 
                });
            }
            
            if (!apellido || apellido.trim() === '') {
                console.log('❌ Apellido faltante o vacío');
                return res.status(400).json({ 
                    error: 'El apellido es obligatorio' 
                });
            }

            // Nueva validación para comuna
            if (!comuna || comuna.trim() === '') {
                console.log('❌ Comuna faltante o vacía');
                return res.status(400).json({ 
                    error: 'La comuna es obligatoria' 
                });
            }
            
            if (!clave || clave.trim() === '') {
                console.log('❌ Clave faltante o vacía');
                return res.status(400).json({ 
                    error: 'La clave es obligatoria' 
                });
            }
            
            if (!rol || rol.trim() === '') {
                console.log('❌ Rol faltante o vacío');
                return res.status(400).json({ 
                    error: 'El rol es obligatorio' 
                });
            }
            
            console.log('✅ Todos los campos válidos');
            
            // Generate ID if not provided, or use provided one
            const userId = id && id.trim() ? id.trim() : `USR_${Date.now()}`;
            console.log('🆔 ID a usar:', userId);
            
            // Check if user with same id already exists
            const [existingUser] = await connection.execute('SELECT id FROM usuario WHERE id = ?', [userId]);
            if (existingUser.length > 0) {
                return res.status(400).json({ 
                    error: `Ya existe un usuario con el ID: ${userId}` 
                });
            }
            
            // Verify that the role exists
            const [rolExists] = await connection.execute('SELECT rol FROM rol WHERE rol = ?', [rol.trim()]);
            if (rolExists.length === 0) {
                console.log('❌ Rol no válido:', rol);
                return res.status(400).json({ 
                    error: `El rol '${rol}' no existe. Use uno de los roles válidos.` 
                });
            }
            
            const hashedPassword = await bcrypt.hash(clave.trim(), 12);
            console.log('🔐 Contraseña hasheada exitosamente en el servidor');
            
            // Execute INSERT with comuna field
            console.log('💾 Ejecutando INSERT...');
            const insertQuery = 'INSERT INTO usuario (id, clave, nombre, apellido, comuna, rol, activo) VALUES (?, ?, ?, ?, ?, ?, ?)';
            const insertParams = [
                userId, 
                hashedPassword,
                nombre.trim(), 
                apellido.trim(), 
                comuna.trim(), // NUEVO CAMPO
                rol.trim(), 
                activo !== undefined ? (activo ? 1 : 0) : 1
            ];
            
            console.log('📝 Query:', insertQuery);
            console.log('📝 Params:', insertParams.map((p, i) => i === 1 ? '[PASSWORD_HASH_HIDDEN]' : p));        
            const [result] = await connection.execute(insertQuery, insertParams);
            
            console.log('✅ INSERT ejecutado exitosamente');
            console.log('📊 Resultado:', result);
            
            // Return success response
            res.status(201).json({ 
                success: true,
                message: 'Usuario creado exitosamente',
                usuario: {
                    id: userId,
                    nombre: nombre.trim(),
                    apellido: apellido.trim(),
                    comuna: comuna.trim(), // Nuevo campo
                    rol: rol.trim(),
                    activo: activo !== undefined ? (activo ? 1 : 0) : 1
                }
            });
            
        } catch (error) {
            console.error('💥 ERROR COMPLETO:', error);
            console.error('📋 Error details:', {
                message: error.message,
                code: error.code,
                errno: error.errno,
                sql: error.sql,
                sqlState: error.sqlState,
                sqlMessage: error.sqlMessage
            });
            
            // Handle duplicate key error
            if (error.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ 
                    error: 'Ya existe un usuario con ese ID'
                });
            }
            
            res.status(500).json({ 
                error: 'Error creando usuario',
                details: error.message
            });
        } finally {
            if (connection) {
                connection.release();
                console.log('🔓 Conexión liberada');
            }
        }
    });

    // =============================================
    // ACTUALIZAR USUARIO CON COMUNA
    // =============================================

    app.put('/api/usuarios/:id', async (req, res) => {
        let connection;
        try {
            const { id } = req.params;
            const { nombre, apellido, comuna, clave, rol, activo } = req.body;
            
            console.log(`✏️ Actualizando usuario ${id}:`, req.body);
            
            connection = await pool.getConnection();
            
            // Verificar que el usuario existe
            const [userExists] = await connection.execute('SELECT id FROM usuario WHERE id = ? AND activo = 1', [id]);
            if (userExists.length === 0) {
                return res.status(404).json({ error: 'Usuario no encontrado' });
            }
            
            // Validar campos requeridos incluyendo comuna
            if (!nombre || !apellido || !comuna || !rol) {
                return res.status(400).json({ 
                    error: 'Nombre, apellido, comuna y rol son obligatorios' 
                });
            }
            
            // Verificar que el rol existe
            const [rolExists] = await connection.execute('SELECT rol FROM rol WHERE rol = ?', [rol]);
            if (rolExists.length === 0) {
                return res.status(400).json({ 
                    error: `El rol '${rol}' no existe. Roles válidos: ADM, API` 
                });
            }
            
            // Preparar la consulta de actualización con comuna
            let updateQuery;
            let updateParams;
            
            if (clave && clave.trim()) {
                const hashedPassword = await bcrypt.hash(clave.trim(), 12);
                console.log('🔐 Contraseña actualizada y hasheada en el servidor');
                // Actualizar con nueva clave
                updateQuery = `
                    UPDATE usuario 
                    SET nombre = ?, apellido = ?, comuna = ?, clave = ?, rol = ?, activo = ?
                    WHERE id = ?
                `;
                updateParams = [
                    nombre.trim(), 
                    apellido.trim(), 
                    comuna.trim(), 
                    hashedPassword, 
                    rol, 
                    activo !== undefined ? (activo ? 1 : 0) : 1,
                    id
                ];
            } else {
                // Actualizar sin cambiar la clave
                updateQuery = `
                    UPDATE usuario 
                    SET nombre = ?, apellido = ?, comuna = ?, rol = ?, activo = ?
                    WHERE id = ?
                `;
                updateParams = [
                    nombre.trim(), 
                    apellido.trim(), 
                    comuna.trim(), 
                    rol, 
                    activo !== undefined ? (activo ? 1 : 0) : 1,
                    id
                ];
            }
            
            // Ejecutar actualización
            await connection.execute(updateQuery, updateParams);
            
            console.log('✅ Usuario actualizado:', id);
            
            // Obtener el usuario actualizado para devolverlo
            const [updatedUser] = await connection.execute(`
                SELECT u.id, u.nombre, u.apellido, u.comuna, u.rol, u.activo,
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
                    comuna: updatedUser[0].comuna, // Nuevo campo
                    email: updatedUser[0].id,
                    telefono: '',
                    fecha_registro: new Date().toISOString(),
                    rol: updatedUser[0].rol,
                    rol_nombre: updatedUser[0].rol_nombre || 'Usuario',
                    activo: updatedUser[0].activo
                }
            });
            
        } catch (error) {
            console.error('💥 Error actualizando usuario:', error);
            res.status(500).json({ 
                error: 'Error actualizando usuario',
                details: process.env.NODE_ENV === 'development' ? error.message : 'Error interno'
            });
        } finally {
            if (connection) connection.release();
        }
    });

    app.delete('/api/usuarios/:id', async (req, res) => {
        let connection;
        try {
            const { id } = req.params;
            
            console.log(`🗑️ Eliminando usuario ${id}`);
            
            connection = await pool.getConnection();
            
            // Verificar que el usuario existe
            const [userExists] = await connection.execute('SELECT id, nombre, apellido FROM usuario WHERE id = ? AND activo = 1', [id]);
            if (userExists.length === 0) {
                return res.status(404).json({ error: 'Usuario no encontrado' });
            }
            
            const usuario = userExists[0];
            
            // Verificar si el usuario tiene colmenas asociadas
            const [colmenasAsociadas] = await connection.execute('SELECT COUNT(*) as count FROM colmena WHERE dueno = ?', [id]);
            
            if (colmenasAsociadas[0].count > 0) {
                return res.status(400).json({ 
                    error: `No se puede eliminar el usuario porque tiene ${colmenasAsociadas[0].count} colmena(s) asociada(s). Primero transfiere o elimina las colmenas.`
                });
            }
            
            // Soft delete - marcar como inactivo
            await connection.execute('UPDATE usuario SET activo = 0 WHERE id = ?', [id]);
            
            console.log('✅ Usuario marcado como inactivo:', id);
            res.json({ 
                message: `Usuario "${usuario.nombre} ${usuario.apellido}" eliminado correctamente`,
                id: id
            });
            
        } catch (error) {
            console.error('💥 Error eliminando usuario:', error);
            
            // Error específico para foreign key constraint
            if (error.code === 'ER_ROW_IS_REFERENCED_2') {
                return res.status(400).json({ 
                    error: 'No se puede eliminar el usuario porque tiene registros asociados (colmenas, estaciones, etc.)'
                });
            }
            
            res.status(500).json({ 
                error: 'Error eliminando usuario',
                details: process.env.NODE_ENV === 'development' ? error.message : 'Error interno'
            });
        } finally {
            if (connection) connection.release();
        }
    });

    // =============================================
    // RUTAS PARA ROLES
    // =============================================

    app.get('/api/roles', async (req, res) => {
        let connection;
        try {
            console.log('👥 Obteniendo roles...');
            
            connection = await pool.getConnection();
            
            const [rows] = await connection.execute(`
                SELECT rol as id, rol, descripcion 
                FROM rol 
                ORDER BY rol
            `);
            
            console.log('✅ Roles obtenidos:', rows.length);
            res.json(rows);
        } catch (error) {
            console.error('💥 Error obteniendo roles:', error);
            res.status(500).json({ error: 'Error obteniendo roles' });
        } finally {
            if (connection) connection.release();
        }
    });


    // =============================================
    // RUTAS PARA COLMENAS - CORREGIDAS PARA ESQUEMA REAL
    // =============================================

    app.get('/api/colmenas', async (req, res) => {
        let connection;
        try {
            console.log('🏠 Obteniendo colmenas...');
            
            connection = await pool.getConnection();
            
            const [colmenas] = await connection.execute(`
                SELECT c.id, c.descripcion, c.latitud, c.longitud, c.dueno,
                    u.nombre as dueno_nombre, u.apellido as dueno_apellido, u.comuna as dueno_comuna
                FROM colmena c
                LEFT JOIN usuario u ON c.dueno = u.id
                ORDER BY c.id ASC
            `);
            
            // Formatear para compatibilidad con frontend
            const colmenasFormateadas = colmenas.map(colmena => ({
                id: colmena.id,
                nombre: `Colmena ${colmena.id}`,
                tipo: 'Langstroth',
                descripcion: colmena.descripcion,
                dueno: colmena.dueno,
                dueno_nombre: colmena.dueno_nombre,
                dueno_apellido: colmena.dueno_apellido,
                apiario_id: null,
                apiario_nombre: colmena.dueno_comuna || 'Sin ubicación',
                fecha_instalacion: new Date().toISOString(),
                activa: 1,
                latitud: colmena.latitud,
                longitud: colmena.longitud,
                ubicacion: colmena.latitud && colmena.longitud ? `${colmena.latitud}, ${colmena.longitud}` : null,
                comuna: colmena.dueno_comuna
            }));
            
            console.log('✅ Colmenas obtenidas:', colmenasFormateadas.length);
            res.json(colmenasFormateadas);
            
        } catch (error) {
            console.error('💥 Error obteniendo colmenas:', error);
            console.error('Error details:', error.message);
            res.status(500).json({ 
                error: 'Error obteniendo colmenas',
                details: error.message 
            });
        } finally {
            if (connection) connection.release();
        }
    });

    app.post('/api/colmenas', async (req, res) => {
        let connection;
        try {
            console.log('➕ Creando nueva colmena con datos:', req.body);
            
            const { descripcion, latitud, longitud, dueno } = req.body;
            
            // Validar campos requeridos según el nuevo esquema
            if (!descripcion || !latitud || !longitud || !dueno) {
                return res.status(400).json({ 
                    error: 'Descripción, latitud, longitud y dueño son obligatorios' 
                });
            }
            
            connection = await pool.getConnection();
            
            // Verificar que el dueño existe
            const [duenoExists] = await connection.execute('SELECT id FROM usuario WHERE id = ? AND activo = 1', [dueno]);
            if (duenoExists.length === 0) {
                return res.status(400).json({ error: 'El usuario dueño no existe o está inactivo' });
            }
            
            // Validar coordenadas
            const lat = parseFloat(latitud);
            const lng = parseFloat(longitud);
            
            if (isNaN(lat) || lat < -90 || lat > 90) {
                return res.status(400).json({ error: 'La latitud debe ser un número entre -90 y 90' });
            }
            
            if (isNaN(lng) || lng < -180 || lng > 180) {
                return res.status(400).json({ error: 'La longitud debe ser un número entre -180 y 180' });
            }
            
            // Generar ID único para la colmena
            const colmenaId = `COL-${Date.now().toString()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
            
            // Insertar nueva colmena según el nuevo esquema
            await connection.execute(`
                INSERT INTO colmena (id, descripcion, latitud, longitud, dueno) 
                VALUES (?, ?, ?, ?, ?)
            `, [colmenaId, descripcion.trim(), lat, lng, dueno]);
            
            console.log('✅ Colmena creada exitosamente:', colmenaId);
            
            res.status(201).json({
                id: colmenaId,
                descripcion: descripcion.trim(),
                latitud: lat,
                longitud: lng,
                dueno: dueno,
                message: 'Colmena creada exitosamente'
            });
            
        } catch (error) {
            console.error('💥 Error creando colmena:', error);
            res.status(500).json({ 
                error: 'Error creando colmena',
                details: error.message 
            });
        } finally {
            if (connection) connection.release();
        }
    });
    // =============================================
    // RUTAS PARA ESTACIONES (NUEVO)
    // =============================================

    app.get('/api/estaciones', async (req, res) => {
        let connection;
        try {
            console.log('🌡️ Obteniendo estaciones...');
            
            connection = await pool.getConnection();
            
            const [estaciones] = await connection.execute(`
                SELECT e.id, e.descripcion, e.latitud, e.longitud, e.dueno,
                    u.nombre as dueno_nombre, u.apellido as dueno_apellido, u.comuna as dueno_comuna
                FROM estacion e
                LEFT JOIN usuario u ON e.dueno = u.id
                ORDER BY e.id ASC
            `);
            
            res.json(estaciones);
            
        } catch (error) {
            console.error('💥 Error obteniendo estaciones:', error);
            res.status(500).json({ 
                error: 'Error obteniendo estaciones',
                details: error.message 
            });
        } finally {
            if (connection) connection.release();
        }
    });

    app.post('/api/estaciones', async (req, res) => {
        let connection;
        try {
            const { descripcion, latitud, longitud, dueno } = req.body;
            
            if (!descripcion || !latitud || !longitud || !dueno) {
                return res.status(400).json({ 
                    error: 'Descripción, latitud, longitud y dueño son obligatorios' 
                });
            }
            
            connection = await pool.getConnection();
            
            const estacionId = `EST-${Date.now()}`;
            
            await connection.execute(`
                INSERT INTO estacion (id, descripcion, latitud, longitud, dueno) 
                VALUES (?, ?, ?, ?, ?)
            `, [estacionId, descripcion.trim(), parseFloat(latitud), parseFloat(longitud), dueno]);
            
            res.status(201).json({
                id: estacionId,
                message: 'Estación creada exitosamente'
            });
            
        } catch (error) {
            console.error('💥 Error creando estación:', error);
            res.status(500).json({ 
                error: 'Error creando estación',
                details: error.message 
            });
        } finally {
            if (connection) connection.release();
        }
    });
    // =============================================
    // RUTAS PARA NODOS - CORREGIDAS PARA ESQUEMA REAL
    // =============================================

    app.get('/api/nodos', async (req, res) => {
        let connection;
        try {
            console.log('🔌 Obteniendo nodos...');
            
            connection = await pool.getConnection();
            
            const [rows] = await connection.execute(`
                SELECT n.id, n.descripcion, n.tipo,
                    nt.descripcion as tipo_descripcion
                FROM nodo n
                LEFT JOIN nodo_tipo nt ON n.tipo = nt.tipo
                ORDER BY n.id ASC
            `);
            
            // Formatear para frontend
            const nodos = rows.map(nodo => ({
                id: nodo.id,
                identificador: nodo.id,
                descripcion: nodo.descripcion,
                tipo: nodo.tipo_descripcion || nodo.tipo,
                fecha_instalacion: new Date().toISOString(),
                activo: true
            }));
            
            console.log('✅ Nodos obtenidos:', nodos.length);
            res.json(nodos);
            
        } catch (error) {
            console.error('💥 Error obteniendo nodos:', error);
            res.status(500).json({ error: 'Error obteniendo nodos' });
        } finally {
            if (connection) connection.release();
        }
    });

    app.get('/api/nodo-tipos', async (req, res) => {
        let connection;
        try {
            console.log('🔧 Obteniendo tipos de nodos...');
            
            connection = await pool.getConnection();
            
            const [rows] = await connection.execute(`
                SELECT tipo as id, tipo, descripcion 
                FROM nodo_tipo 
                ORDER BY tipo ASC
            `);
            
            console.log('✅ Tipos de nodos obtenidos:', rows.length);
            res.json(rows);
            
        } catch (error) {
            console.error('💥 Error obteniendo tipos de nodos:', error);
            res.status(500).json({ error: 'Error obteniendo tipos de nodos' });
        } finally {
            if (connection) connection.release();
        }
    });
    // =============================================
    // RUTAS PARA NODO_MENSAJE - DATOS REALES
    // =============================================

    // Endpoint principal: Obtener mensajes recientes
    app.get('/api/nodo-mensajes/recientes', async (req, res) => {
        let connection;
        try {
            const hours = parseInt(req.query.hours) || 24;
            const limit = parseInt(req.query.limit) || 500;
            
            console.log(`📈 Obteniendo datos recientes (últimas ${hours}h, límite ${limit})...`);
            
            connection = await pool.getConnection();
            
            const query = `
                SELECT nm.id, nm.nodo_id, nm.topico, nm.payload, nm.fecha
                FROM nodo_mensaje nm
                WHERE nm.fecha >= DATE_SUB(NOW(), INTERVAL ? HOUR)
                ORDER BY nm.fecha ASC
                LIMIT ?
            `;
            
            const [rows] = await connection.execute(query, [hours, limit]);
            console.log('✅ Mensajes obtenidos de BD:', rows.length);
            
            const mensajes = rows.map(mensaje => {
                let parsedPayload = {};
                
                try {
                    parsedPayload = JSON.parse(mensaje.payload);
                } catch (parseError) {
                    console.warn('⚠️ Error parsing payload JSON:', parseError.message);
                    parsedPayload = { 
                        error: 'Invalid JSON',
                        raw: mensaje.payload 
                    };
                }
                
                return {
                    id: mensaje.id,
                    nodo_id: mensaje.nodo_id,
                    topico: mensaje.topico,
                    payload: mensaje.payload,
                    fecha: mensaje.fecha,
                    temperatura: parsedPayload.temperatura || null,
                    humedad: parsedPayload.humedad || null,
                    peso: parsedPayload.peso || null,
                    latitud: parsedPayload.latitud || null,
                    longitud: parsedPayload.longitud || null
                };
            });
            
            console.log('📊 Mensajes procesados para frontend:', mensajes.length);
            res.json(mensajes);
            
        } catch (error) {
            console.error('💥 Error en /api/nodo-mensajes/recientes:', error);
            res.status(500).json({ 
                error: 'Error obteniendo datos recientes',
                details: error.message,
                code: error.code || 'UNKNOWN'
            });
        } finally {
            if (connection) connection.release();
        }
    });

    // Endpoint simple de respaldo
    app.get('/api/nodo-mensajes/simple', async (req, res) => {
        let connection;
        try {
            console.log('📊 Obteniendo mensajes (versión simple)...');
            
            connection = await pool.getConnection();
            
            const [rows] = await connection.execute(`
                SELECT id, nodo_id, topico, payload, fecha
                FROM nodo_mensaje 
                ORDER BY fecha DESC 
                LIMIT 100
            `);
            
            const mensajes = rows.map(mensaje => ({
                id: mensaje.id,
                nodo_id: mensaje.nodo_id,
                topico: mensaje.topico,
                payload: mensaje.payload,
                fecha: mensaje.fecha
            }));
            
            console.log('✅ Mensajes obtenidos (simple):', mensajes.length);        
            res.json(mensajes);
            
        } catch (error) {
            console.error('💥 Error en endpoint simple:', error);
            res.status(500).json({ 
                error: 'Error obteniendo mensajes simple',
                details: error.message 
            });
        } finally {
            if (connection) connection.release();
        }
    });

    // Endpoint de diagnóstico
    app.get('/api/debug/nodo-mensaje-info', async (req, res) => {
        let connection;
        try {
            console.log('🔧 Ejecutando diagnóstico completo...');
            
            connection = await pool.getConnection();
            
            const diagnostico = {
                timestamp: new Date().toISOString(),
                database: null,
                tables: [],
                nodo_mensaje: {
                    exists: false,
                    structure: [],
                    totalRows: 0,
                    samples: [],
                    errors: []
                }
            };
            
            try {
                const [dbInfo] = await connection.execute('SELECT DATABASE() as db_name, NOW() as current_time');
                diagnostico.database = dbInfo[0];
                
                const [allTables] = await connection.execute('SHOW TABLES');
                diagnostico.tables = allTables.map(table => Object.values(table)[0]);
                
                if (diagnostico.tables.includes('nodo_mensaje')) {
                    diagnostico.nodo_mensaje.exists = true;
                    
                    const [structure] = await connection.execute('DESCRIBE nodo_mensaje');
                    diagnostico.nodo_mensaje.structure = structure;
                    
                    const [count] = await connection.execute('SELECT COUNT(*) as total FROM nodo_mensaje');
                    diagnostico.nodo_mensaje.totalRows = count[0].total;
                    
                    if (diagnostico.nodo_mensaje.totalRows > 0) {
                        const [samples] = await connection.execute(`
                            SELECT id, nodo_id, topico, 
                                LEFT(payload, 100) as payload_preview, 
                                fecha
                            FROM nodo_mensaje 
                            ORDER BY fecha DESC 
                            LIMIT 5
                        `);
                        diagnostico.nodo_mensaje.samples = samples;
                    }
                }
                
            } catch (error) {
                diagnostico.nodo_mensaje.errors.push({
                    type: 'query_error',
                    message: error.message,
                    code: error.code
                });
            }
            
            res.json(diagnostico);
            
        } catch (error) {
            console.error('💥 Error en diagnóstico:', error);
            res.status(500).json({ 
                error: 'Error ejecutando diagnóstico',
                details: error.message 
            });
        } finally {
            if (connection) connection.release();
        }
    });

    // Endpoint para crear mensaje de prueba
    app.post('/api/nodo-mensajes/test-message', async (req, res) => {
        let connection;
        try {
            console.log('🧪 Creando mensaje de prueba...');
            
            connection = await pool.getConnection();
            
            // Verificar que existe al menos un nodo
            const [existingNodes] = await connection.execute('SELECT id FROM nodo LIMIT 1');
            
            let testNodoId;
            if (existingNodes.length > 0) {
                testNodoId = existingNodes[0].id;
            } else {
                // Crear un nodo de prueba si no existe ninguno
                testNodoId = `NODO-TEST-${Date.now()}`;
                
                // Verificar que existe al menos un tipo de nodo
                const [existingTypes] = await connection.execute('SELECT tipo FROM nodo_tipo LIMIT 1');
                
                let nodoTipo = 'SENSOR';
                if (existingTypes.length > 0) {
                    nodoTipo = existingTypes[0].tipo;
                } else {
                    // Crear tipo de nodo si no existe
                    await connection.execute(
                        'INSERT IGNORE INTO nodo_tipo (tipo, descripcion) VALUES (?, ?)',
                        ['SENSOR', 'Sensor genérico de pruebas']
                    );
                }
                
                // Crear el nodo de prueba
                await connection.execute(
                    'INSERT IGNORE INTO nodo (id, descripcion, tipo) VALUES (?, ?, ?)',
                    [testNodoId, 'Nodo de pruebas automático', nodoTipo]
                );
            }
            
            const testTopico = `SmartBee/nodes/${testNodoId}/data`;
            const testPayload = {
                nodo_id: testNodoId,
                temperatura: (15 + Math.random() * 20).toFixed(1),
                humedad: (40 + Math.random() * 40).toFixed(1),
                peso: (-1 + Math.random() * 3).toFixed(2),
                latitud: (-36.6009157 + (Math.random() - 0.5) * 0.01).toFixed(7),
                longitud: (-72.1064020 + (Math.random() - 0.5) * 0.01).toFixed(7)
            };
            
            const payloadJson = JSON.stringify(testPayload);
            
            const [result] = await connection.execute(`
                INSERT INTO nodo_mensaje (nodo_id, topico, payload) 
                VALUES (?, ?, ?)
            `, [testNodoId, testTopico, payloadJson]);
            
            console.log('✅ Mensaje de prueba creado con ID:', result.insertId);
            
            res.json({
                success: true,
                id: result.insertId,
                nodo_id: testNodoId,
                topico: testTopico,
                payload: testPayload,
                message: 'Mensaje de prueba creado exitosamente'
            });
            
        } catch (error) {
            console.error('💥 Error creando mensaje de prueba:', error);
            res.status(500).json({ 
                error: 'Error creando mensaje de prueba',
                details: error.message 
            });
        } finally {
            if (connection) connection.release();
        }
    });

    // Endpoint para poblar datos base necesarios
    app.post('/api/setup/create-base-data', async (req, res) => {
        let connection;
        try {
            console.log('🔧 Creando datos base para SmartBee...');
            
            connection = await pool.getConnection();
            
            const results = {
                roles: 0,
                nodoTipos: 0,
                nodos: 0,
                alertas: 0
            };
            
            // Crear roles básicos
            const roles = [
                { rol: 'ADM', descripcion: 'Administrador del sistema' },
                { rol: 'API', descripcion: 'Apicultor' },
                { rol: 'USR', descripcion: 'Usuario básico' }
            ];
            
            for (const rolData of roles) {
                try {
                    await connection.execute(
                        'INSERT IGNORE INTO rol (rol, descripcion) VALUES (?, ?)',
                        [rolData.rol, rolData.descripcion]
                    );
                    results.roles++;
                } catch (e) {
                    console.warn('⚠️ Error insertando rol:', e.message);
                }
            }
            
            // Crear tipos de nodos
            const nodoTipos = [
                { tipo: 'COLMENA', descripcion: 'Nodo sensor para colmenas' },
                { tipo: 'ESTACION', descripcion: 'Estación meteorológica' },
                { tipo: 'SENSOR', descripcion: 'Sensor genérico' }
            ];
            
            for (const tipoData of nodoTipos) {
                try {
                    await connection.execute(
                        'INSERT IGNORE INTO nodo_tipo (tipo, descripcion) VALUES (?, ?)',
                        [tipoData.tipo, tipoData.descripcion]
                    );
                    results.nodoTipos++;
                } catch (e) {
                    console.warn('⚠️ Error insertando nodo_tipo:', e.message);
                }
            }
            
            // Crear nodos de ejemplo
            const nodosEjemplo = [
                { id: 'NODO-7881883A-97A5-47E0-869C-753E99E1B168', descripcion: 'Nodo sensor principal', tipo: 'SENSOR' },
                { id: 'NODO-TEST-001', descripcion: 'Nodo de pruebas 1', tipo: 'SENSOR' },
                { id: 'NODO-TEST-002', descripcion: 'Nodo de pruebas 2', tipo: 'SENSOR' }
            ];
            
            for (const nodoData of nodosEjemplo) {
                try {
                    await connection.execute(
                        'INSERT IGNORE INTO nodo (id, descripcion, tipo) VALUES (?, ?, ?)',
                        [nodoData.id, nodoData.descripcion, nodoData.tipo]
                    );
                    results.nodos++;
                } catch (e) {
                    console.warn('⚠️ Error insertando nodo:', e.message);
                }
            }
            
            console.log('✅ Datos base creados:', results);
            
            res.json({
                success: true,
                message: 'Datos base creados exitosamente',
                results: results
            });
            
        } catch (error) {
            console.error('💥 Error creando datos base:', error);
            res.status(500).json({ 
                error: 'Error creando datos base',
                details: error.message 
            });
        } finally {
            if (connection) connection.release();
        }
    });
    // =============================================
    // RUTAS PARA DASHBOARD - CORREGIDAS
    // =============================================

    app.get('/api/dashboard/stats', async (req, res) => {
        let connection;
        try {
            console.log('📊 Obteniendo estadísticas del dashboard...');
            
            connection = await pool.getConnection();
            
            const [usuarios] = await connection.execute('SELECT COUNT(*) as count FROM usuario WHERE activo = 1');
            const [colmenas] = await connection.execute('SELECT COUNT(*) as count FROM colmena');
            const [nodos] = await connection.execute('SELECT COUNT(*) as count FROM nodo');
            
            // Contar estaciones (con manejo de errores)
            let estacionesCount = 0;
            try {
                const [estaciones] = await connection.execute('SELECT COUNT(*) as count FROM estacion');
                estacionesCount = estaciones[0].count;
            } catch (e) {
                console.log('⚠️ Tabla estacion no encontrada');
            }
            
            // Contar mensajes de hoy
            let mensajesHoyCount = 0;
            try {
                const [mensajesHoy] = await connection.execute(`
                    SELECT COUNT(*) as count FROM nodo_mensaje 
                    WHERE DATE(fecha) = CURDATE()
                `);
                mensajesHoyCount = mensajesHoy[0].count;
            } catch (e) {
                console.log('⚠️ Tabla nodo_mensaje no encontrada');
            }
            
            const stats = {
                totalColmenas: colmenas[0].count,
                totalEstaciones: estacionesCount,
                totalUsuarios: usuarios[0].count,
                totalNodos: nodos[0].count,
                mensajesHoy: mensajesHoyCount,
                colmenasActivas: colmenas[0].count
            };
            
            res.json(stats);
            
        } catch (error) {
            console.error('💥 Error obteniendo estadísticas:', error);
            res.status(500).json({ 
                error: 'Error obteniendo estadísticas',
                details: error.message 
            });
        } finally {
            if (connection) connection.release();
        }
    });

    // =============================================
    // VERIFICAR DATOS OFICIALES
    // =============================================

    app.get('/api/admin/verify-data', async (req, res) => {
        let connection;
        try {
            console.log('🔧 Verificando datos oficiales...');
            
            connection = await pool.getConnection();
            
            // Verificar roles
            const [roles] = await connection.execute('SELECT rol, descripcion FROM rol ORDER BY rol');
            
            // Verificar tipos de nodos
            const [nodoTipos] = await connection.execute('SELECT tipo, descripcion FROM nodo_tipo ORDER BY tipo');
            
            // Verificar nodos
            const [nodos] = await connection.execute('SELECT COUNT(*) as count FROM nodo WHERE activo = 1');
            
            // Verificar ubicaciones de nodos
            const [ubicaciones] = await connection.execute('SELECT COUNT(*) as count FROM nodo_ubicacion WHERE activo = 1');
            
            // Verificar alertas
            const [alertas] = await connection.execute('SELECT COUNT(*) as count FROM alerta');
            
            // Verificar usuarios
            const [usuarios] = await connection.execute('SELECT COUNT(*) as count FROM usuario WHERE activo = 1');
            
            res.json({
                message: 'Verificación de datos oficiales completada',
                data: {
                    roles: roles,
                    nodoTipos: nodoTipos,
                    counts: {
                        nodos: nodos[0].count,
                        ubicaciones: ubicaciones[0].count,
                        alertas: alertas[0].count,
                        usuarios: usuarios[0].count
                    }
                }
            });
            
        } catch (error) {
            console.error('💥 Error verificando datos:', error);
            res.status(500).json({ 
                error: 'Error verificando datos',
                details: error.message 
            });
        } finally {
            if (connection) connection.release();
        }
    });

    // =============================================
    // CREAR USUARIO ROOT OFICIAL
    // =============================================

    app.post('/api/admin/create-root', async (req, res) => {
        let connection;
        try {
            console.log('🔧 Creando usuario root oficial...');
            
            const { clave } = req.body;
            
            if (!clave) {
                return res.status(400).json({ 
                    error: 'Se requiere una clave para el usuario root' 
                });
            }
            
            connection = await pool.getConnection();
            
            // Verificar si ya existe el usuario root
            const [rootExists] = await connection.execute('SELECT id FROM usuario WHERE id = ?', ['root']);
            
            if (rootExists.length > 0) {
                return res.status(400).json({ 
                    error: 'El usuario root ya existe' 
                });
            }
            
            // Crear usuario root según las especificaciones oficiales
            await connection.execute(`
                INSERT INTO usuario (id, clave, nombre, apellido, rol, activo) 
                VALUES (?, ?, ?, ?, ?, 1)
            `, ['root', clave, 'Roberto', 'Carraso', 'ADM']);
            
            console.log('✅ Usuario root creado exitosamente');
            
            res.json({
                message: 'Usuario root creado exitosamente',
                usuario: {
                    id: 'root',
                    nombre: 'Roberto',
                    apellido: 'Carraso',
                    rol: 'ADM'
                }
            });
            
        } catch (error) {
            console.error('💥 Error creando usuario root:', error);
            res.status(500).json({ 
                error: 'Error creando usuario root',
                details: error.message 
            });
        } finally {
            if (connection) connection.release();
        }
    });

    // =============================================
    // ENDPOINT PARA VERIFICAR Y PREPARAR BASE DE DATOS
    // =============================================

    app.get('/api/admin/check-schema', async (req, res) => {
        let connection;
        try {
            connection = await pool.getConnection();
            
            // Verificar todas las tablas del esquema
            const requiredTables = [
                'rol', 'usuario', 'nodo_tipo', 'nodo', 'colmena', 
                'nodo_colmena', 'nodo_mensaje', 'nodo_ubicacion', 'nodo_alerta', 'alerta'
            ];
            
            const tableInfo = {};
            
            for (const tableName of requiredTables) {
                try {
                    const [exists] = await connection.execute(`
                        SELECT TABLE_NAME 
                        FROM information_schema.TABLES 
                        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
                    `, [tableName]);
                    
                    if (exists.length > 0) {
                        const [count] = await connection.execute(`SELECT COUNT(*) as count FROM ${tableName}`);
                        const [columns] = await connection.execute(`DESCRIBE ${tableName}`);
                        
                        tableInfo[tableName] = {
                            exists: true,
                            rowCount: count[0].count,
                            columns: columns.length
                        };
                    } else {
                        tableInfo[tableName] = {
                            exists: false,
                            error: 'Tabla no encontrada'
                        };
                    }
                } catch (e) {
                    tableInfo[tableName] = {
                        exists: false,
                        error: e.message
                    };
                }
            }
            
            res.json({
                database: 'Connected',
                schema: 'smartbee',
                tables: tableInfo,
                summary: {
                    total: requiredTables.length,
                    existing: Object.values(tableInfo).filter(t => t.exists).length,
                    missing: Object.values(tableInfo).filter(t => !t.exists).length
                }
            });
            
        } catch (error) {
            console.error('Error checking schema:', error);
            res.status(500).json({ 
                error: 'Error checking database schema',
                details: error.message 
            });
        } finally {
            if (connection) connection.release();
        }
    });




    // =============================================
    // RUTAS PARA DASHBOARD
    // =============================================

    app.get('/api/dashboard/stats', async (req, res) => {
        let connection;
        try {
            console.log('📊 Obteniendo estadísticas del dashboard...');
            
            connection = await pool.getConnection();
            
            const [usuarios] = await connection.execute('SELECT COUNT(*) as count FROM usuario');
            const [colmenas] = await connection.execute('SELECT COUNT(*) as count FROM colmena');
            
            // Verificar si existe la tabla mensaje antes de consultarla
            let mensajesHoy = [{ count: 0 }];
            try {
                const [mensajes] = await connection.execute(`
                    SELECT COUNT(*) as count FROM mensaje 
                    WHERE DATE(fecha) = CURDATE()
                `);
                mensajesHoy = mensajes;
            } catch (mensajeError) {
                console.log('⚠️ Tabla mensaje no encontrada, usando valor por defecto');
            }
            
            const stats = {
                totalColmenas: colmenas[0].count,
                totalUsuarios: usuarios[0].count,
                mensajesHoy: mensajesHoy[0].count,
                colmenasActivas: colmenas[0].count
            };
            
            console.log('✅ Estadísticas obtenidas:', stats);
            res.json(stats);
            
        } catch (error) {
            console.error('💥 Error obteniendo estadísticas:', error);
            console.error('Error details:', error.message);
            res.status(500).json({ 
                error: 'Error obteniendo estadísticas',
                details: error.message 
            });
        } finally {
            if (connection) connection.release();
        }
    });

    // =============================================
    // RUTAS PARA ROLES
    // =============================================

    app.get('/api/roles', async (req, res) => {
        let connection;
        try {
            console.log('👥 Obteniendo roles...');
            
            connection = await pool.getConnection();
            
            const [rows] = await connection.execute(`
                SELECT rol as id, descripcion 
                FROM rol 
                ORDER BY rol
            `);
            
            console.log('✅ Roles obtenidos:', rows.length);
            res.json(rows);
        } catch (error) {
            console.error('💥 Error obteniendo roles:', error);
            res.status(500).json({ error: 'Error obteniendo roles' });
        } finally {
            if (connection) connection.release();
        }
    });

    // =============================================
    // RUTAS PARA REVISIONES (COMPATIBILIDAD)
    // =============================================

    app.get('/api/revisiones', async (req, res) => {
        try {
            console.log('📝 Obteniendo revisiones...');
            
            // Como no tienes tabla de revisiones, devolver array vacío
            // pero con estructura compatible
            res.json([]);
        } catch (error) {
            console.error('💥 Error obteniendo revisiones:', error);
            res.status(500).json({ error: 'Error obteniendo revisiones' });
        }
    });

    app.post('/api/revisiones', async (req, res) => {
        try {
            // Placeholder para crear revisiones
            res.json({ 
                message: 'Funcionalidad de revisiones pendiente de implementación',
                id: Date.now()
            });
        } catch (error) {
            console.error('💥 Error creando revisión:', error);
            res.status(500).json({ error: 'Error creando revisión' });
        }
    });

    // =============================================
    // RUTAS AUXILIARES
    // =============================================

    app.get('/api/select/usuarios', async (req, res) => {
        let connection;
        try {
            connection = await pool.getConnection();
            const [rows] = await connection.execute('SELECT id, nombre, apellido FROM usuario ORDER BY nombre');
            res.json(rows);
        } catch (error) {
            console.error('Error obteniendo usuarios para select:', error);
            res.status(500).json({ error: 'Error obteniendo usuarios' });
        } finally {
            if (connection) connection.release();
        }
    });

    app.get('/api/colmenas/activas', async (req, res) => {
        let connection;
        try {
            connection = await pool.getConnection();
            const [rows] = await connection.execute(`
                SELECT id, CONCAT('Colmena #', id) as nombre FROM colmena ORDER BY id
            `);
            res.json(rows);
        } catch (error) {
            console.error('Error obteniendo colmenas activas:', error);
            res.status(500).json({ error: 'Error obteniendo colmenas activas' });
        } finally {
            if (connection) connection.release();
        }
    });

    // =============================================
    // RUTA DE DEBUG ADICIONAL
    // =============================================

    app.get('/api/debug/estructura', async (req, res) => {
        let connection;
        try {
            connection = await pool.getConnection();
            const [tables] = await connection.execute('SHOW TABLES');
            
            let estructura = { tablas: tables };
            
            // Obtener estructura de cada tabla
            for (const table of tables) {
                const tableName = table[Object.keys(table)[0]];
                try {
                    const [columns] = await connection.execute(`DESCRIBE ${tableName}`);
                    estructura[tableName] = columns;
                } catch (e) {
                    estructura[`${tableName}_error`] = e.message;
                }
            }
            
            res.json(estructura);
        } catch (error) {
            res.status(500).json({ error: error.message });
        } finally {
            if (connection) connection.release();
        }
    });

    app.get('/api/debug/logs', (req, res) => {
        res.json({
            message: 'Endpoint para debug. Revisa los logs del servidor.',
            timestamp: new Date().toISOString()
        });
    });

    // =============================================
    // MIDDLEWARE DE MANEJO DE ERRORES
    // =============================================

    app.use((err, req, res, next) => {
        console.error('💥 Error no manejado:', err);
        console.error('Stack trace:', err.stack);
        console.error('Request details:', {
            method: req.method,
            url: req.url,
            body: req.body,
            params: req.params,
            query: req.query
        });
        
        res.status(500).json({ 
            message: 'Error interno del servidor',
            error: process.env.NODE_ENV === 'development' ? {
                message: err.message,
                stack: err.stack
            } : {}
        });
    });

    app.use('*', (req, res) => {
        res.status(404).json({ message: 'Ruta no encontrada' });
    });

    // =============================================
    // INICIAR SERVIDOR
    // =============================================

    const startServer = async () => {
        try {
            console.log('🔄 Probando conexión a Railway...');
            const connection = await pool.getConnection();
            console.log('✅ Conexión exitosa a Railway MySQL');
            connection.release();
            
            app.listen(PORT, () => {
                console.log(`🚀 Servidor SmartBee ejecutándose en puerto ${PORT}`);
                console.log(`🌐 API disponible en: http://localhost:${PORT}/api`);
                console.log(`🗄️  Base de datos: Railway MySQL`);
                console.log(`📋 Endpoints disponibles:`);
                console.log(`   ✅ GET  /api/health`);
                console.log(`   ✅ GET  /api/test-db`);
                console.log(`   ✅ GET  /api/debug/check-tables`);
                console.log(`   ✅ GET  /api/test-connection`);
                console.log(`   ✅ POST /api/usuarios/login`);
                console.log(`   ✅ GET  /api/usuarios`);
                console.log(`   ✅ POST /api/usuarios`);
                console.log(`   ✅ GET  /api/colmenas`);
                console.log(`   ✅ POST /api/colmenas`);
                console.log(`   ✅ GET  /api/nodos`);
                console.log(`   ✅ GET  /api/dashboard/stats`);
                console.log(`   ✅ GET  /api/roles`);
                console.log(`   ✅ GET  /api/debug/estructura`);
            });
        } catch (error) {
            console.error('❌ Error conectando a Railway:', error.message);
            
            app.listen(PORT, () => {
                console.log(`🚀 Servidor SmartBee (modo desarrollo) en puerto ${PORT}`);
                console.log(`⚠️  Sin conexión a base de datos`);
            });
        }
    };

    startServer();

    process.on('SIGINT', async () => {
        console.log('\n🔄 Cerrando servidor...');
        await pool.end();
        console.log('✅ Pool de conexiones cerrado');
        process.exit(0);
    });
