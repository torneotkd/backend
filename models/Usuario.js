
const { pool } = require('../config/database');
const bcrypt = require('bcryptjs');

class Usuario {
    static async findAll() {
        try {
            const [rows] = await pool.execute(`
                SELECT u.id, u.nombre, u.apellido, u.clave, r.descripcion as rol_descripcion
                FROM usuario u 
                INNER JOIN rol r ON u.rol = r.id
            `);
            return rows;
        } catch (error) {
            throw new Error(`Error obteniendo usuarios: ${error.message}`);
        }
    }

    static async findById(id) {
        try {
            const [rows] = await pool.execute(`
                SELECT u.id, u.nombre, u.apellido, u.clave, u.rol, r.descripcion as rol_descripcion
                FROM usuario u 
                INNER JOIN rol r ON u.rol = r.id 
                WHERE u.id = ?
            `, [id]);
            return rows[0];
        } catch (error) {
            throw new Error(`Error obteniendo usuario: ${error.message}`);
        }
    }

    static async findByCredentials(clave) {
        try {
            const [rows] = await pool.execute(`
                SELECT u.id, u.nombre, u.apellido, u.clave, u.rol, r.descripcion as rol_descripcion
                FROM usuario u 
                INNER JOIN rol r ON u.rol = r.id 
                WHERE u.clave = ?
            `, [clave]);
            return rows[0];
        } catch (error) {
            throw new Error(`Error buscando usuario: ${error.message}`);
        }
    }

    static async create(userData) {
        try {
            const { nombre, apellido, clave, rol = 2 } = userData;
            
            // Hash de la contraseña
            const hashedPassword = await bcrypt.hash(clave, 10);
            
            const [result] = await pool.execute(`
                INSERT INTO usuario (nombre, apellido, clave, rol) 
                VALUES (?, ?, ?, ?)
            `, [nombre, apellido, hashedPassword, rol]);
            
            return result.insertId;
        } catch (error) {
            throw new Error(`Error creando usuario: ${error.message}`);
        }
    }

    static async update(id, userData) {
        try {
            const { nombre, apellido, clave, rol } = userData;
            let query = 'UPDATE usuario SET nombre = ?, apellido = ?, rol = ?';
            let params = [nombre, apellido, rol];
            
            if (clave) {
                const hashedPassword = await bcrypt.hash(clave, 10);
                query += ', clave = ?';
                params.push(hashedPassword);
            }
            
            query += ' WHERE id = ?';
            params.push(id);
            
            const [result] = await pool.execute(query, params);
            return result.affectedRows > 0;
        } catch (error) {
            throw new Error(`Error actualizando usuario: ${error.message}`);
        }
    }

    static async delete(id) {
        try {
            const [result] = await pool.execute('DELETE FROM usuario WHERE id = ?', [id]);
            return result.affectedRows > 0;
        } catch (error) {
            throw new Error(`Error eliminando usuario: ${error.message}`);
        }
    }
}

module.exports = Usuario;