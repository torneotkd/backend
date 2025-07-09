const express = require('express');
const db = require('../config/database');

const router = express.Router();

// GET - Obtener todos los apiarios
router.get('/', async (req, res) => {
    try {
        const { usuario_id } = req.query;
        
        let query = `
            SELECT a.id, a.nombre, a.ubicacion, a.descripcion, a.fecha_creacion,
                   u.nombre as propietario_nombre, u.apellido as propietario_apellido,
                   COUNT(c.id) as total_colmenas
            FROM apiario a
            LEFT JOIN usuario u ON a.usuario_id = u.id
            LEFT JOIN colmena c ON a.id = c.apiario_id
        `;
        
        let params = [];
        
        if (usuario_id) {
            query += ' WHERE a.usuario_id = ?';
            params.push(usuario_id);
        }
        
        query += ' GROUP BY a.id ORDER BY a.fecha_creacion DESC';
        
        const apiarios = await db.getMany(query, params);
        
        res.json(apiarios);
    } catch (error) {
        console.error('Error obteniendo apiarios:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// GET - Obtener apiario por ID
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const apiario = await db.getOne(`
            SELECT a.id, a.nombre, a.ubicacion, a.descripcion, a.fecha_creacion,
                   a.usuario_id, u.nombre as propietario_nombre, u.apellido as propietario_apellido
            FROM apiario a
            LEFT JOIN usuario u ON a.usuario_id = u.id
            WHERE a.id = ?
        `, [id]);
        
        if (!apiario) {
            return res.status(404).json({ error: 'Apiario no encontrado' });
        }
        
        // Obtener colmenas del apiario
        const colmenas = await db.getMany(`
            SELECT c.id, c.nombre, c.tipo, c.estado, c.fecha_instalacion,
                   COUNT(r.id) as total_revisiones,
                   MAX(r.fecha_revision) as ultima_revision
            FROM colmena c
            LEFT JOIN revision r ON c.id = r.colmena_id
            WHERE c.apiario_id = ?
            GROUP BY c.id
            ORDER BY c.fecha_instalacion DESC
        `, [id]);
        
        res.json({
            ...apiario,
            colmenas
        });
    } catch (error) {
        console.error('Error obteniendo apiario:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// POST - Crear nuevo apiario
router.post('/', async (req, res) => {
    try {
        const { nombre, ubicacion, descripcion, usuario_id } = req.body;
        
        // Validaciones básicas
        if (!nombre || !ubicacion || !usuario_id) {
            return res.status(400).json({ 
                error: 'Nombre, ubicación y usuario son obligatorios' 
            });
        }
        
        // Verificar que el usuario existe
        const usuario = await db.getOne('SELECT id FROM usuario WHERE id = ?', [usuario_id]);
        if (!usuario) {
            return res.status(400).json({ error: 'Usuario no encontrado' });
        }
        
        // Crear apiario
        const resultado = await db.insert('apiario', {
            nombre,
            ubicacion,
            descripcion: descripcion || null,
            usuario_id,
            fecha_creacion: new Date()
        });
        
        // Obtener el apiario creado
        const nuevoApiario = await db.getOne(`
            SELECT a.id, a.nombre, a.ubicacion, a.descripcion, a.fecha_creacion,
                   u.nombre as propietario_nombre, u.apellido as propietario_apellido
            FROM apiario a
            LEFT JOIN usuario u ON a.usuario_id = u.id
            WHERE a.id = ?
        `, [resultado.insertId]);
        
        res.status(201).json({
            message: 'Apiario creado exitosamente',
            apiario: nuevoApiario
        });
    } catch (error) {
        console.error('Error creando apiario:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// PUT - Actualizar apiario
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, ubicacion, descripcion } = req.body;
        
        // Verificar si el apiario existe
        const apiarioExistente = await db.getOne(
            'SELECT id FROM apiario WHERE id = ?', 
            [id]
        );
        
        if (!apiarioExistente) {
            return res.status(404).json({ error: 'Apiario no encontrado' });
        }
        
        // Preparar datos a actualizar
        const datosActualizar = {};
        if (nombre) datosActualizar.nombre = nombre;
        if (ubicacion) datosActualizar.ubicacion = ubicacion;
        if (descripcion !== undefined) datosActualizar.descripcion = descripcion;
        
        // Actualizar apiario
        await db.update('apiario', datosActualizar, 'id = ?', [id]);
        
        // Obtener apiario actualizado
        const apiarioActualizado = await db.getOne(`
            SELECT a.id, a.nombre, a.ubicacion, a.descripcion, a.fecha_creacion,
                   u.nombre as propietario_nombre, u.apellido as propietario_apellido
            FROM apiario a
            LEFT JOIN usuario u ON a.usuario_id = u.id
            WHERE a.id = ?
        `, [id]);
        
        res.json({
            message: 'Apiario actualizado exitosamente',
            apiario: apiarioActualizado
        });
    } catch (error) {
        console.error('Error actualizando apiario:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// DELETE - Eliminar apiario
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Verificar si el apiario existe
        const apiario = await db.getOne(
            'SELECT id, nombre FROM apiario WHERE id = ?', 
            [id]
        );
        
        if (!apiario) {
            return res.status(404).json({ error: 'Apiario no encontrado' });
        }
        
        // Verificar si tiene colmenas asociadas
        const colmenas = await db.getOne(
            'SELECT COUNT(*) as total FROM colmena WHERE apiario_id = ?', 
            [id]
        );
        
        if (colmenas.total > 0) {
            return res.status(400).json({ 
                error: 'No se puede eliminar el apiario porque tiene colmenas asociadas' 
            });
        }
        
        // Eliminar apiario
        const resultado = await db.delete('apiario', 'id = ?', [id]);
        
        if (resultado.affectedRows === 0) {
            return res.status(400).json({ error: 'No se pudo eliminar el apiario' });
        }
        
        res.json({
            message: 'Apiario eliminado exitosamente',
            apiario: apiario
        });
    } catch (error) {
        console.error('Error eliminando apiario:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// GET - Obtener estadísticas del apiario
router.get('/:id/estadisticas', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Verificar que el apiario existe
        const apiario = await db.getOne('SELECT id FROM apiario WHERE id = ?', [id]);
        if (!apiario) {
            return res.status(404).json({ error: 'Apiario no encontrado' });
        }
        
        // Estadísticas de colmenas
        const estadisticasColmenas = await db.getOne(`
            SELECT 
                COUNT(*) as total_colmenas,
                SUM(CASE WHEN estado = 'activa' THEN 1 ELSE 0 END) as colmenas_activas,
                SUM(CASE WHEN estado = 'inactiva' THEN 1 ELSE 0 END) as colmenas_inactivas
            FROM colmena 
            WHERE apiario_id = ?
        `, [id]);
        
        // Última revisión
        const ultimaRevision = await db.getOne(`
            SELECT r.fecha_revision, c.nombre as colmena_nombre
            FROM revision r
            JOIN colmena c ON r.colmena_id = c.id
            WHERE c.apiario_id = ?
            ORDER BY r.fecha_revision DESC
            LIMIT 1
        `, [id]);
        
        // Revisiones por mes (últimos 6 meses)
        const revisionesPorMes = await db.getMany(`
            SELECT 
                DATE_FORMAT(r.fecha_revision, '%Y-%m') as mes,
                COUNT(*) as total_revisiones
            FROM revision r
            JOIN colmena c ON r.colmena_id = c.id
            WHERE c.apiario_id = ? 
            AND r.fecha_revision >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
            GROUP BY DATE_FORMAT(r.fecha_revision, '%Y-%m')
            ORDER BY mes DESC
        `, [id]);
        
        res.json({
            ...estadisticasColmenas,
            ultima_revision: ultimaRevision,
            revisiones_por_mes: revisionesPorMes
        });
    } catch (error) {
        console.error('Error obteniendo estadísticas del apiario:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

module.exports = router;