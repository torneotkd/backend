// Backend - models/Apiario.js
const db = require('../config/database');

class Apiario {
  constructor(datos) {
    this.id = datos.id;
    this.nombre = datos.nombre;
    this.ubicacion = datos.ubicacion;
    this.descripcion = datos.descripcion;
    this.usuario_id = datos.usuario_id;
    this.fecha_creacion = datos.fecha_creacion;
  }

  static async obtenerTodos(usuarioId = null) {
    let query = `
      SELECT a.id, a.nombre, a.ubicacion, a.descripcion, a.fecha_creacion,
             u.nombre as propietario_nombre, u.apellido as propietario_apellido,
             COUNT(c.id) as total_colmenas
      FROM apiario a
      LEFT JOIN usuario u ON a.usuario_id = u.id
      LEFT JOIN colmena c ON a.id = c.apiario_id
    `;
    
    let params = [];
    if (usuarioId) {
      query += ' WHERE a.usuario_id = ?';
      params.push(usuarioId);
    }
    
    query += ' GROUP BY a.id ORDER BY a.fecha_creacion DESC';
    
    const apiarios = await db.getMany(query, params);
    return apiarios.map(apiario => new Apiario(apiario));
  }

  static async obtenerPorId(id) {
    const query = `
      SELECT a.id, a.nombre, a.ubicacion, a.descripcion, a.fecha_creacion,
             a.usuario_id, u.nombre as propietario_nombre, u.apellido as propietario_apellido
      FROM apiario a
      LEFT JOIN usuario u ON a.usuario_id = u.id
      WHERE a.id = ?
    `;
    
    const apiario = await db.getOne(query, [id]);
    return apiario ? new Apiario(apiario) : null;
  }

  static async crear(datos) {
    const resultado = await db.insert('apiario', {
      nombre: datos.nombre.trim(),
      ubicacion: datos.ubicacion.trim(),
      descripcion: datos.descripcion ? datos.descripcion.trim() : null,
      usuario_id: datos.usuario_id,
      fecha_creacion: new Date()
    });

    return await Apiario.obtenerPorId(resultado.insertId);
  }

  async actualizar(datos) {
    const datosActualizar = {};
    if (datos.nombre) datosActualizar.nombre = datos.nombre.trim();
    if (datos.ubicacion) datosActualizar.ubicacion = datos.ubicacion.trim();
    if (datos.descripcion !== undefined) datosActualizar.descripcion = datos.descripcion ? datos.descripcion.trim() : null;

    await db.update('apiario', datosActualizar, 'id = ?', [this.id]);
    Object.assign(this, datosActualizar);
    return this;
  }

  async eliminar() {
    await db.delete('apiario', 'id = ?', [this.id]);
    return true;
  }

  async obtenerColmenas() {
    const query = `
      SELECT c.id, c.nombre, c.tipo, c.estado, c.fecha_instalacion,
             COUNT(r.id) as total_revisiones,
             MAX(r.fecha_revision) as ultima_revision
      FROM colmena c
      LEFT JOIN revision r ON c.id = r.colmena_id
      WHERE c.apiario_id = ?
      GROUP BY c.id
      ORDER BY c.fecha_instalacion DESC
    `;
    
    return await db.getMany(query, [this.id]);
  }
}
