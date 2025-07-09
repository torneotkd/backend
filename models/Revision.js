// Backend - models/Revision.js
class Revision {
  constructor(datos) {
    this.id = datos.id;
    this.colmena_id = datos.colmena_id;
    this.fecha_revision = datos.fecha_revision;
    this.num_alzas = datos.num_alzas;
    this.marcos_abejas = datos.marcos_abejas;
    this.marcos_cria = datos.marcos_cria;
    this.marcos_alimento = datos.marcos_alimento;
    this.marcos_polen = datos.marcos_polen;
    this.presencia_varroa = datos.presencia_varroa;
    this.condicion_reina = datos.condicion_reina;
    this.producto_sanitario = datos.producto_sanitario;
    this.dosis_sanitario = datos.dosis_sanitario;
    this.notas = datos.notas;
  }

  static async obtenerTodas(filtros = {}) {
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
    
    if (filtros.colmena_id) {
      query += ' AND r.colmena_id = ?';
      params.push(filtros.colmena_id);
    }
    
    if (filtros.fecha_desde) {
      query += ' AND r.fecha_revision >= ?';
      params.push(filtros.fecha_desde);
    }
    
    if (filtros.fecha_hasta) {
      query += ' AND r.fecha_revision <= ?';
      params.push(filtros.fecha_hasta);
    }
    
    query += ' ORDER BY r.fecha_revision DESC LIMIT ?';
    params.push(filtros.limite || 50);
    
    const revisiones = await db.getMany(query, params);
    return revisiones.map(revision => new Revision(revision));
  }

  static async crear(datos) {
    const resultado = await db.insert('revision', {
      colmena_id: datos.colmena_id,
      fecha_revision: new Date(datos.fecha_revision),
      num_alzas: datos.num_alzas || 0,
      marcos_abejas: datos.marcos_abejas || 0,
      marcos_cria: datos.marcos_cria || 0,
      marcos_alimento: datos.marcos_alimento || 0,
      marcos_polen: datos.marcos_polen || 0,
      presencia_varroa: datos.presencia_varroa || 'no',
      condicion_reina: datos.condicion_reina || 'buena',
      producto_sanitario: datos.producto_sanitario || null,
      dosis_sanitario: datos.dosis_sanitario || null,
      notas: datos.notas || null
    });

    return await Revision.obtenerPorId(resultado.insertId);
  }

  async actualizar(datos) {
    const datosActualizar = {};
    
    if (datos.fecha_revision) datosActualizar.fecha_revision = new Date(datos.fecha_revision);
    if (datos.num_alzas !== undefined) datosActualizar.num_alzas = datos.num_alzas;
    if (datos.marcos_abejas !== undefined) datosActualizar.marcos_abejas = datos.marcos_abejas;
    if (datos.marcos_cria !== undefined) datosActualizar.marcos_cria = datos.marcos_cria;
    if (datos.marcos_alimento !== undefined) datosActualizar.marcos_alimento = datos.marcos_alimento;
    if (datos.marcos_polen !== undefined) datosActualizar.marcos_polen = datos.marcos_polen;
    if (datos.presencia_varroa) datosActualizar.presencia_varroa = datos.presencia_varroa;
    if (datos.condicion_reina) datosActualizar.condicion_reina = datos.condicion_reina;
    if (datos.producto_sanitario !== undefined) datosActualizar.producto_sanitario = datos.producto_sanitario;
    if (datos.dosis_sanitario !== undefined) datosActualizar.dosis_sanitario = datos.dosis_sanitario;
    if (datos.notas !== undefined) datosActualizar.notas = datos.notas;

    await db.update('revision', datosActualizar, 'id = ?', [this.id]);
    Object.assign(this, datosActualizar);
    return this;
  }

  async eliminar() {
    await db.delete('revision', 'id = ?', [this.id]);
    return true;
  }

  static async obtenerResumen(colmenaId, periodo = 'mes') {
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
    `, [colmenaId]);

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
    `, [colmenaId]);

    return { resumen, evolucion };
  }

  static async generarAlertas(colmenaId) {
    const alertas = [];

    // Verificar última revisión
    const ultimaRevision = await db.getOne(`
      SELECT fecha_revision, DATEDIFF(NOW(), fecha_revision) as dias_desde_revision
      FROM revision 
      WHERE colmena_id = ? 
      ORDER BY fecha_revision DESC 
      LIMIT 1
    `, [colmenaId]);

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
    `, [colmenaId]);

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
    `, [colmenaId]);

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
    `, [colmenaId]);

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

    return alertas;
  }

  static validar(datos) {
    const errores = {};

    if (!datos.colmena_id) {
      errores.colmena_id = 'La colmena es obligatoria';
    }

    if (!datos.fecha_revision) {
      errores.fecha_revision = 'La fecha de revisión es obligatoria';
    }

    // Validar que la fecha no sea futura
    const fechaRevision = new Date(datos.fecha_revision);
    const ahora = new Date();
    if (fechaRevision > ahora) {
      errores.fecha_revision = 'La fecha no puede ser futura';
    }

    // Validaciones de campos numéricos
    const camposNumericos = ['num_alzas', 'marcos_abejas', 'marcos_cria', 'marcos_alimento', 'marcos_polen'];
    camposNumericos.forEach(campo => {
      if (datos[campo] !== undefined) {
        const valor = parseInt(datos[campo]);
        if (isNaN(valor) || valor < 0) {
          errores[campo] = 'Debe ser un número válido mayor o igual a 0';
        }
      }
    });

    return {
      valido: Object.keys(errores).length === 0,
      errores
    };
  }
}

module.exports = { Apiario, Colmena, Revision };
  