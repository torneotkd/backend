const express = require('express');
const db = require('../config/database');

const router = express.Router();

// GET - Obtener todas las colmenas
router.get('/', async (req, res) => {
    try {
        const { apiario_id } = req.query;
        
        let query = `
            SELECT c.id, c.nombre, c.tipo, c.estado, c.fecha_instalacion,
                   a.nombre as apiario_nombre, a.id as apiario_id,
                   COUNT(r.id) as total_revisiones,
                   MAX(r.fecha_revision) as ultima_revision
            FROM colmena c
            LEFT JOIN apiario a ON c.apiario_id = a.id
            LEFT JOIN revision r ON c.id = r.colmena_id
        `;
        
        let params = [];
        
        if (apiario_id) {
            query += ' WHERE c.apiario_id = ?';
            params.push(apiario_id);
        }
        
        query += ' GROUP BY c.id ORDER BY c.fecha_instalacion DESC';
        
        const colmenas = await db.getMany(query, params);
        
        res.json(colmenas);
    } catch (error) {
        console.error('Error obteniendo colmenas:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// GET - Obtener colmena por ID
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const colmena = await db.getOne(`
            SELECT c.id, c.nombre, c.tipo, c.estado, c.fecha_instalacion,
                   c.apiario_id, a.nombre as apiario_nombre, a.ubicacion as apiario_ubicacion
            FROM colmena c
            LEFT JOIN apiario a ON c.apiario_id = a.id
            WHERE c.id = ?
        `, [id]);
        
        if (!colmena) {
            return res.status(404).json({ error: 'Colmena no encontrada' });
        }
        
        // Obtener revisiones de la colmena
        const revisiones = await db.getMany(`
            SELECT r.id, r.fecha_revision, r.num_alzas, r.marcos_abejas, r.marcos_cria,
                   r.marcos_alimento, r.marcos_polen, r.presencia_varroa, r.condicion_reina,
                   r.producto_sanitario, r.dosis_sanitario, r.notas
            FROM revision r
            WHERE r.colmena_id = ?
            ORDER BY r.fecha_revision DESC
            LIMIT 10
        `, [id]);
        
        // Obtener datos de sensores (temperatura, humedad, peso)
        const datosSensores = await db.getMany(`
            SELECT n.tipo_sensor, n.valor, n.fecha_lectura, n.unidad
            FROM nodo n
            JOIN nodo_colmena nc ON n.id = nc.nodo_id
            WHERE nc.colmena_id = ?
            ORDER BY n.fecha_lectura DESC
            LIMIT 100
        `, [id]);
        
        res.json({
            ...colmena,
            revisiones,
            datos_sensores: datosSensores
        });
    } catch (error) {
        console.error('Error obteniendo colmena:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// POST - Crear nueva colmena
router.post('/', async (req, res) => {
    try {
        const { nombre, tipo, estado = 'activa', apiario_id } = req.body;
        
        // Validaciones básicas
        if (!nombre || !tipo || !apiario_id) {
            return res.status(400).json({ 
                error: 'Nombre, tipo y apiario son obligatorios' 
            });
        }
        
        // Verificar que el apiario existe
        const apiario = await db.getOne('SELECT id FROM apiario WHERE id = ?', [apiario_id]);
        if (!apiario) {
            return res.status(400).json({ error: 'Apiario no encontrado' });
        }
        
        // Crear colmena
        const resultado = await db.insert('colmena', {
            nombre,
            tipo,
            estado,
            apiario_id,
            fecha_instalacion: new Date()
        });
        
        // Obtener la colmena creada
        const nuevaColmena = await db.getOne(`
            SELECT c.id, c.nombre, c.tipo, c.estado, c.fecha_instalacion,
                   a.nombre as apiario_nombre
            FROM colmena c
            LEFT JOIN apiario a ON c.apiario_id = a.id
            WHERE c.id = ?
        `, [resultado.insertId]);
        
        res.status(201).json({
            message: 'Colmena creada exitosamente',
            colmena: nuevaColmena
        });
    } catch (error) {
        console.error('Error creando colmena:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// PUT - Actualizar colmena
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, tipo, estado } = req.body;
        
        // Verificar si la colmena existe
        const colmenaExistente = await db.getOne(
            'SELECT id FROM colmena WHERE id = ?', 
            [id]
        );
        
        if (!colmenaExistente) {
            return res.status(404).json({ error: 'Colmena no encontrada' });
        }
        
        // Preparar datos a actualizar
        const datosActualizar = {};
        if (nombre) datosActualizar.nombre = nombre;
        if (tipo) datosActualizar.tipo = tipo;
        if (estado) datosActualizar.estado = estado;
        
        // Actualizar colmena
        await db.update('colmena', datosActualizar, 'id = ?', [id]);
        
        // Obtener colmena actualizada
        const colmenaActualizada = await db.getOne(`
            SELECT c.id, c.nombre, c.tipo, c.estado, c.fecha_instalacion,
                   a.nombre as apiario_nombre
            FROM colmena c
            LEFT JOIN apiario a ON c.apiario_id = a.id
            WHERE c.id = ?
        `, [id]);
        
        res.json({
            message: 'Colmena actualizada exitosamente',
            colmena: colmenaActualizada
        });
    } catch (error) {
        console.error('Error actualizando colmena:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// DELETE - Eliminar colmena
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Verificar si la colmena existe
        const colmena = await db.getOne(
            'SELECT id, nombre FROM colmena WHERE id = ?', 
            [id]
        );
        
        if (!colmena) {
            return res.status(404).json({ error: 'Colmena no encontrada' });
        }
        
        // Verificar si tiene revisiones asociadas
        const revisiones = await db.getOne(
            'SELECT COUNT(*) as total FROM revision WHERE colmena_id = ?', 
            [id]
        );
        
        if (revisiones.total > 0) {
            return res.status(400).json({ 
                error: 'No se puede eliminar la colmena porque tiene revisiones asociadas' 
            });
        }
        
        // Eliminar relaciones con nodos
        await db.delete('nodo_colmena', 'colmena_id = ?', [id]);
        
        // Eliminar colmena
        const resultado = await db.delete('colmena', 'id = ?', [id]);
        
        if (resultado.affectedRows === 0) {
            return res.status(400).json({ error: 'No se pudo eliminar la colmena' });
        }
        
        res.json({
            message: 'Colmena eliminada exitosamente',
            colmena: colmena
        });
    } catch (error) {
        console.error('Error eliminando colmena:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// GET - Obtener datos de sensores de una colmena
router.get('/:id/sensores', async (req, res) => {
    try {
        const { id } = req.params;
        const { periodo = 'semana', tipo_sensor } = req.query;
        
        // Verificar que la colmena existe
        const colmena = await db.getOne('SELECT id FROM colmena WHERE id = ?', [id]);
        if (!colmena) {
            return res.status(404).json({ error: 'Colmena no encontrada' });
        }
        
        // Determinar el filtro de fecha según el período
        let filtroFecha;
        switch (periodo) {
            case 'dia':
                filtroFecha = 'DATE(n.fecha_lectura) = CURDATE()';
                break;
            case 'semana':
                filtroFecha = 'n.fecha_lectura >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
                break;
            case 'mes':
                filtroFecha = 'n.fecha_lectura >= DATE_SUB(NOW(), INTERVAL 1 MONTH)';
                break;
            case 'año':
                filtroFecha = 'n.fecha_lectura >= DATE_SUB(NOW(), INTERVAL 1 YEAR)';
                break;
            default:
                filtroFecha = 'n.fecha_lectura >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
        }
        
        let query = `
            SELECT n.tipo_sensor, n.valor, n.fecha_lectura, n.unidad
            FROM nodo n
            JOIN nodo_colmena nc ON n.id = nc.nodo_id
            WHERE nc.colmena_id = ? AND ${filtroFecha}
        `;
        
        let params = [id];
        
        if (tipo_sensor) {
            query += ' AND n.tipo_sensor = ?';
            params.push(tipo_sensor);
        }
        
        query += ' ORDER BY n.fecha_lectura DESC';
        
        const datosSensores = await db.getMany(query, params);
        
        // Agrupar datos por tipo de sensor
        const datosAgrupados = datosSensores.reduce((acc, dato) => {
            if (!acc[dato.tipo_sensor]) {
                acc[dato.tipo_sensor] = [];
            }
            acc[dato.tipo_sensor].push({
                valor: dato.valor,
                fecha: dato.fecha_lectura,
                unidad: dato.unidad
            });
            return acc;
        }, {});
        
        res.json({
            periodo,
            datos: datosAgrupados
        });
    } catch (error) {
        console.error('Error obteniendo datos de sensores:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// GET - Obtener estadísticas de una colmena
router.get('/:id/estadisticas', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Verificar que la colmena existe
        const colmena = await db.getOne('SELECT id FROM colmena WHERE id = ?', [id]);
        if (!colmena) {
            return res.status(404).json({ error: 'Colmena no encontrada' });
        }
        
        // Estadísticas de revisiones
        const estadisticasRevisiones = await db.getOne(`
            SELECT 
                COUNT(*) as total_revisiones,
                AVG(num_alzas) as promedio_alzas,
                AVG(marcos_abejas) as promedio_marcos_abejas,
                MAX(fecha_revision) as ultima_revision
            FROM revision 
            WHERE colmena_id = ?
        `, [id]);
        
        // Problemas detectados en las últimas revisiones
        const problemasRecientes = await db.getMany(`
            SELECT fecha_revision, presencia_varroa, condicion_reina, notas
            FROM revision 
            WHERE colmena_id = ? 
            AND (presencia_varroa = 'si' OR condicion_reina != 'buena' OR notas IS NOT NULL)
            ORDER BY fecha_revision DESC
            LIMIT 5
        `, [id]);
        
        res.json({
            ...estadisticasRevisiones,
            problemas_recientes: problemasRecientes
        });
    } catch (error) {
        console.error('Error obteniendo estadísticas de la colmena:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

module.exports = router;