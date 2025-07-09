// Backend - models/Colmena.js
class Colmena {
  constructor(datos) {
    this.id = datos.id;
    this.nombre = datos.nombre;
    this.tipo = datos.tipo;
    this.estado = datos.estado;
    this.apiario_id = datos.apiario_id;
    this.fecha_instalacion = datos.fecha_instalacion;
  }

  static async obtenerTodas(apiarioId = null) {
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
    if (apiarioId) {
      query += ' WHERE c.apiario_id = ?';
      params.push(apiarioId);
    }
    
    query += ' GROUP BY c.id ORDER BY c.fecha_instalacion DESC';
    
    const colmenas = await db.getMany(query, params);
    return colmenas.map(colmena => new Colmena(colmena));
  }

  static async obtenerPorId(id) {
    const query = `
      SELECT c.id, c.nombre, c.tipo, c.estado, c.fecha_instalacion,
             c.apiario_id, a.nombre as apiario_nombre, a.ubicacion as apiario_ubicacion
      FROM colmena c
      LEFT JOIN apiario a ON c.apiario_id = a.id
      WHERE c.id = ?
    `;
    
    const colmena = await db.getOne(query, [id]);
    return colmena ? new Colmena(colmena) : null;
  }

  static async crear(datos) {
    const resultado = await db.insert('colmena', {
      nombre: datos.nombre.trim(),
      tipo: datos.tipo,
      estado: datos.estado || 'activa',
      apiario_id: datos.apiario_id,
      fecha_instalacion: new Date()
    });

    return await Colmena.obtenerPorId(resultado.insertId);
  }

  async actualizar(datos) {
    const datosActualizar = {};
    if (datos.nombre) datosActualizar.nombre = datos.nombre.trim();
    if (datos.tipo) datosActualizar.tipo = datos.tipo;
    if (datos.estado) datosActualizar.estado = datos.estado;

    await db.update('colmena', datosActualizar, 'id = ?', [this.id]);
    Object.assign(this, datosActualizar);
    return this;
  }

  async eliminar() {
    await db.delete('colmena', 'id = ?', [this.id]);
    return true;
  }

  async obtenerRevisiones(limite = 10) {
    const query = `
      SELECT r.id, r.fecha_revision, r.num_alzas, r.marcos_abejas, r.marcos_cria,
             r.marcos_alimento, r.marcos_polen, r.presencia_varroa, r.condicion_reina,
             r.producto_sanitario, r.dosis_sanitario, r.notas
      FROM revision r
      WHERE r.colmena_id = ?
      ORDER BY r.fecha_revision DESC
      LIMIT ?
    `;
    
    return await db.getMany(query, [this.id, limite]);
  }

  async obtenerEstadisticas() {
    const query = `
      SELECT 
        COUNT(*) as total_revisiones,
        AVG(num_alzas) as promedio_alzas,
        AVG(marcos_abejas) as promedio_marcos_abejas,
        MAX(fecha_revision) as ultima_revision
      FROM revision 
      WHERE colmena_id = ?
    `;
    
    return await db.getOne(query, [this.id]);
  }
}