const express = require('express');
const db = require('../config/database');

const router = express.Router();

// GET - Obtener todas las revisiones
router.get('/', async (req, res) => {
    try {
        const { colmena_id, fecha_desde, fecha_hasta, limite = 50 } = req.query;
        
        let query = `
            SELECT r.id, r.fecha_revision, r.num_alzas, r.marcos_abejas, r.marcos_cria,
                   r.marcos_alimento, r.marcos_polen, r.presencia_varroa, r.condicion_reina,
                   r.producto_sanitario, r.dosis_sanitario, r.notas,
                   c.nombre as colmena_nombre, a.nombre as apiario_nombre
            FROM revision r
            JOIN colmena c ON r.colmena_id = c.id
            JOIN apiario a ON c.apiario_id = a.id
            WHERE 1=1
        `;
        
        let params = [];
        
        if (colmena_id) {
            query += ' AND r.colmena_id = ?';
            params.push(colmena_id);
        }
        
        if (fecha_desde) {
            query += ' AND r.fecha_revision >= ?';
            params.push(fecha_desde);
        }
        
        if (fecha_hasta) {
            query += ' AND r.fecha_revision <= ?';
            params.push(fecha_hasta);
        }
        
        query += ' ORDER BY r.fecha_revision DESC LIMIT ?';
        params.push(parseInt(limite));
        
        const revisiones = await db.getMany(query, params);
        
        res.json(revisiones);
    } catch (error) {
        console.error('Error obteniendo revisiones:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// GET - Obtener revisión por ID
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const revision = await db.getOne(`
            SELECT r.id, r.fecha_revision, r.num_alzas, r.marcos_abejas, r.marcos_cria,
                   r.marcos_alimento, r.marcos_polen, r.presencia_varroa, r.condicion_reina,
                   r.producto_sanitario, r.dosis_sanitario, r.notas, r.colmena_id,
                   c.nombre as colmena_nombre, a.nombre as apiario_nombre, a.id as apiario_id
            FROM revision r
            JOIN colmena c ON r.colmena_id = c.id
            JOIN apiario a ON c.apiario_id = a.id
            WHERE r.id = ?
        `, [id]);
        
        if (!revision) {
            return res.status(404).json({ error: 'Revisión no encontrada' });
        }
        
        res.json(revision);
    } catch (error) {
        console.error('Error obteniendo revisión:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// POST - Crear nueva revisión
router.post('/', async (req, res) => {
    try {
        const {
            colmena_id,
            fecha_revision,
            num_alzas,
            marcos_abejas,
            marcos_cria,
            marcos_alimento,
            marcos_polen,
            presencia_varroa = 'no',
            condicion_reina = 'buena',
            producto_sanitario,
            dosis_sanitario,
            notas
        } = req.body;
        
        // Validaciones básicas
        if (!colmena_id || !fecha_revision) {
            return res.status(400).json({ 
                error: 'Colmena y fecha de revisión son obligatorias' 
            });
        }
        
        // Verificar que la colmena existe
        const colmena = await db.getOne('SELECT id FROM colmena WHERE id = ?', [colmena_id]);
        if (!colmena) {
            return res.status(400).json({ error: 'Colmena no encontrada' });
        }
        
        // Crear revisión
        const resultado = await db.insert('revision', {
            colmena_id,
            fecha_revision: new Date(fecha_revision),
            num_alzas: num_alzas || 0,
            marcos_abejas: marcos_abejas || 0,
            marcos_cria: marcos_cria || 0,
            marcos_alimento: marcos_alimento || 0,
            marcos_polen: marcos_polen || 0,
            presencia_varroa,
            condicion_reina,
            producto_sanitario: producto_sanitario || null,
            dosis_sanitario: dosis_sanitario || null,
            notas: notas || null
        });
        
        // Obtener la revisión creada
        const nuevaRevision = await db.getOne(`
            SELECT r.id, r.fecha_revision, r.num_alzas, r.marcos_abejas, r.marcos_cria,
                   r.marcos_alimento, r.marcos_polen, r.presencia_varroa, r.condicion_reina,
                   r.producto_sanitario, r.dosis_sanitario, r.notas,
                   c.nombre as colmena_nombre, a.nombre as apiario_nombre
            FROM revision r
            JOIN colmena c ON r.colmena_id = c.id
            JOIN apiario a ON c.apiario_id = a.id
            WHERE r.id = ?
        `, [resultado.insertId]);
        
        res.status(201).json({
            message: 'Revisión creada exitosamente',
            revision: nuevaRevision
        });
    } catch (error) {
        console.error('Error creando revisión:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// PUT - Actualizar revisión
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            fecha_revision,
            num_alzas,
            marcos_abejas,
            marcos_cria,
            marcos_alimento,
            marcos_polen,
            presencia_varroa,
            condicion_reina,
            producto_sanitario,
            dosis_sanitario,
            notas
        } = req.body;
        
        // Verificar si la revisión existe
        const revisionExistente = await db.getOne(
            'SELECT id FROM revision WHERE id = ?', 
            [id]
        );
        
        if (!revisionExistente) {
            return res.status(404).json({ error: 'Revisión no encontrada' });
        }
        
        // Preparar datos a actualizar
        const datosActualizar = {};
        if (fecha_revision) datosActualizar.fecha_revision = new Date(fecha_revision);
        if (num_alzas !== undefined) datosActualizar.num_alzas = num_alzas;
        if (marcos_abejas !== undefined) datosActualizar.marcos_abejas = marcos_abejas;
        if (marcos_cria !== undefined) datosActualizar.marcos_cria = marcos_cria;
        if (marcos_alimento !== undefined) datosActualizar.marcos_alimento = marcos_alimento;
        if (marcos_polen !== undefined) datosActualizar.marcos_polen = marcos_polen;
        if (presencia_varroa) datosActualizar.presencia_varroa = presencia_varroa;
        if (condicion_reina) datosActualizar.condicion_reina = condicion_reina;
        if (producto_sanitario !== undefined) datosActualizar.producto_sanitario = producto_sanitario;
        if (dosis_sanitario !== undefined) datosActualizar.dosis_sanitario = dosis_sanitario;
        if (notas !== undefined) datosActualizar.notas = notas;
        
        // Actualizar revisión
        await db.update('revision', datosActualizar, 'id = ?', [id]);
        
        // Obtener revisión actualizada
        const revisionActualizada = await db.getOne(`
            SELECT r.id, r.fecha_revision, r.num_alzas, r.marcos_abejas, r.marcos_cria,
                   r.marcos_alimento, r.marcos_polen, r.presencia_varroa, r.condicion_reina,
                   r.producto_sanitario, r.dosis_sanitario, r.notas,
                   c.nombre as colmena_nombre, a.nombre as apiario_nombre
            FROM revision r
            JOIN colmena c ON r.colmena_id = c.id
            JOIN apiario a ON c.apiario_id = a.id
            WHERE r.id = ?
        `, [id]);
        
        res.json({
            message: 'Revisión actualizada exitosamente',
            revision: revisionActualizada
        });
    } catch (error) {
        console.error('Error actualizando revisión:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// DELETE - Eliminar revisión
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Verificar si la revisión existe
        const revision = await db.getOne(`
            SELECT r.id, r.fecha_revision, c.nombre as colmena_nombre
            FROM revision r
            JOIN colmena c ON r.colmena_id = c.id
            WHERE r.id = ?
        `, [id]);
        
        if (!revision) {
            return res.status(404).json({ error: 'Revisión no encontrada' });
        }
        
        // Eliminar revisión
        const resultado = await db.delete('revision', 'id = ?', [id]);
        
        if (resultado.affectedRows === 0) {
            return res.status(400).json({ error: 'No se pudo eliminar la revisión' });
        }
        
        res.json({
            message: 'Revisión eliminada exitosamente',
            revision: revision
        });
    } catch (error) {
        console.error('Error eliminando revisión:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// GET - Obtener resumen de revisiones por colmena
router.get('/resumen/:colmena_id', async (req, res) => {
    try {
        const { colmena_id } = req.params;
        const { periodo = 'mes' } = req.query;
        
        // Verificar que la colmena existe
        const colmena = await db.getOne('SELECT id FROM colmena WHERE id = ?', [colmena_id]);
        if (!colmena) {
            return res.status(404).json({ error: 'Colmena no encontrada' });
        }
        
        // Determinar el filtro de fecha según el período
        let filtroFecha;
        switch (periodo) {
            case 'semana':
                filtroFecha = 'fecha_revision >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
                break;
            case 'mes':
                filtroFecha = 'fecha_revision >= DATE_SUB(NOW(), INTERVAL 1 MONTH)';
                break;
            case 'trimestre':
                filtroFecha = 'fecha_revision >= DATE_SUB(NOW(), INTERVAL 3 MONTH)';
                break;
            case 'año':
                filtroFecha = 'fecha_revision >= DATE_SUB(NOW(), INTERVAL 1 YEAR)';
                break;
            default:
                filtroFecha = 'fecha_revision >= DATE_SUB(NOW(), INTERVAL 1 MONTH)';
        }
        
        // Resumen estadístico
        const resumen = await db.getOne(`
            SELECT 
                COUNT(*) as total_revisiones,
                AVG(num_alzas) as promedio_alzas,
                AVG(marcos_abejas) as promedio_marcos_abejas,
                AVG(marcos_cria) as promedio_marcos_cria,
                AVG(marcos_alimento) as promedio_marcos_alimento,
                AVG(marcos_polen) as promedio_marcos_polen,
                SUM(CASE WHEN presencia_varroa = 'si' THEN 1 ELSE 0 END) as detecciones_varroa,
                MAX(fecha_revision) as ultima_revision
            FROM revision 
            WHERE colmena_id = ? AND ${filtroFecha}
        `, [colmena_id]);
        
        // Evolución temporal
        const evolucion = await db.getMany(`
            SELECT 
                DATE(fecha_revision) as fecha,
                num_alzas,
                marcos_abejas,
                marcos_cria,
                presencia_varroa,
                condicion_reina
            FROM revision 
            WHERE colmena_id = ? AND ${filtroFecha}
            ORDER BY fecha_revision ASC
        `, [colmena_id]);
        
        res.json({
            periodo,
            resumen,
            evolucion
        });
    } catch (error) {
        console.error('Error obteniendo resumen de revisiones:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// GET - Obtener alertas basadas en revisiones
router.get('/alertas/:colmena_id', async (req, res) => {
    try {
        const { colmena_id } = req.params;
        
        // Verificar que la colmena existe
        const colmena = await db.getOne('SELECT id, nombre FROM colmena WHERE id = ?', [colmena_id]);
        if (!colmena) {
            return res.status(404).json({ error: 'Colmena no encontrada' });
        }
        
        const alertas = [];
        
        // Verificar última revisión
        const ultimaRevision = await db.getOne(`
            SELECT fecha_revision, DATEDIFF(NOW(), fecha_revision) as dias_desde_revision
            FROM revision 
            WHERE colmena_id = ? 
            ORDER BY fecha_revision DESC 
            LIMIT 1
        `, [colmena_id]);
        
        if (!ultimaRevision) {
            alertas.push({
                tipo: 'warning',
                mensaje: 'No hay revisiones registradas para esta colmena',
                prioridad: 'media'
            });
        } else if (ultimaRevision.dias_desde_revision > 30) {
            alertas.push({
                tipo: 'warning',
                mensaje: `Última revisión hace ${ultimaRevision.dias_desde_revision} días`,
                prioridad: 'alta'
            });
        }
        
        // Verificar presencia recurrente de varroa
        const varroaRecurrente = await db.getOne(`
            SELECT COUNT(*) as detecciones
            FROM revision 
            WHERE colmena_id = ? 
            AND presencia_varroa = 'si' 
            AND fecha_revision >= DATE_SUB(NOW(), INTERVAL 2 MONTH)
        `, [colmena_id]);
        
        if (varroaRecurrente.detecciones >= 2) {
            alertas.push({
                tipo: 'danger',
                mensaje: 'Múltiples detecciones de varroa en los últimos 2 meses',
                prioridad: 'alta'
            });
        }
        
        // Verificar problemas con la reina
        const problemasReina = await db.getOne(`
            SELECT COUNT(*) as problemas
            FROM revision 
            WHERE colmena_id = ? 
            AND condicion_reina != 'buena' 
            AND fecha_revision >= DATE_SUB(NOW(), INTERVAL 1 MONTH)
        `, [colmena_id]);
        
        if (problemasReina.problemas > 0) {
            alertas.push({
                tipo: 'warning',
                mensaje: 'Problemas detectados con la reina en el último mes',
                prioridad: 'media'
            });
        }
        
        // Verificar descenso en marcos de cría
        const tendenciaCria = await db.getMany(`
            SELECT marcos_cria, fecha_revision
            FROM revision 
            WHERE colmena_id = ? 
            ORDER BY fecha_revision DESC 
            LIMIT 3
        `, [colmena_id]);
        
        if (tendenciaCria.length >= 2) {
            const ultimosCria = tendenciaCria.map(r => r.marcos_cria);
            const descendente = ultimosCria.every((val, i) => i === 0 || val <= ultimosCria[i-1]);
            
            if (descendente && ultimosCria[0] < ultimosCria[ultimosCria.length-1]) {
                alertas.push({
                    tipo: 'info',
                    mensaje: 'Tendencia descendente en marcos de cría',
                    prioridad: 'baja'
                });
            }
        }
        
        res.json({
            colmena: colmena.nombre,
            total_alertas: alertas.length,
            alertas
        });
    } catch (error) {
        console.error('Error obteniendo alertas:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

module.exports = router;