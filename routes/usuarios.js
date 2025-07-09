const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');

const router = express.Router();

// POST - Login usando tu estructura real
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    console.log('🔐 Login attempt for:', email);
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }
    
    // Buscar usuario por nombre O por email
    const usuario = await db.getOne(`
      SELECT id, nombre, apellido, email, password, rol 
      FROM usuario 
      WHERE nombre = ? OR email = ?
    `, [email, email]);
    
    console.log('👤 User found:', usuario ? 'Yes' : 'No');
    
    if (!usuario) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }
    
    console.log('🔑 Stored password:', usuario.password);
    console.log('🔑 Input password:', password);
    
    // Verificar contraseña (texto plano o hasheada)
    let passwordMatch = false;
    
    if (usuario.password && usuario.password.startsWith('$2')) {
      // Contraseña hasheada con bcrypt
      console.log('🔑 Comparing hashed password...');
      passwordMatch = await bcrypt.compare(password, usuario.password);
    } else {
      // Contraseña en texto plano
      console.log('🔑 Comparing plain text password...');
      passwordMatch = (usuario.password === password);
      
      if (passwordMatch) {
        // Hashear para la próxima vez
        console.log('🔑 Hashing password for security...');
        const hashedPassword = await bcrypt.hash(password, 10);
        await db.update('usuario', { password: hashedPassword }, 'id = ?', [usuario.id]);
      }
    }
    
    console.log('🔑 Password match:', passwordMatch);
    
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }
    
    // Crear token
    const token = jwt.sign(
      { 
        userId: usuario.id, 
        nombre: usuario.nombre,
        email: usuario.email 
      },
      'secreto_temporal',
      { expiresIn: '24h' }
    );
    
    console.log('✅ Login successful for:', usuario.nombre);
    
    res.json({
      message: 'Login exitoso',
      token,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        email: usuario.email || usuario.nombre,
        rol_nombre: 'Apicultor'
      }
    });
    
  } catch (error) {
    console.error('💥 LOGIN ERROR:', error);
    res.status(500).json({ 
      error: 'Error del servidor',
      message: error.message 
    });
  }
});

// GET - Debug tabla
router.get('/debug-table', async (req, res) => {
  try {
    const columns = await db.getMany('SHOW COLUMNS FROM usuario');
    const users = await db.getMany('SELECT id, nombre, apellido, email, password, rol FROM usuario');
    
    console.log('📋 Table structure:', columns);
    console.log('👥 All users:', users);
    
    res.json({ 
      columns: columns,
      users: users
    });
  } catch (error) {
    console.error('🔍 Debug error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET - Crear usuario de prueba
router.get('/create-test-user', async (req, res) => {
  try {
    console.log('🔧 Creating test user...');
    
    // Eliminar usuario existente si existe
    await db.execute('DELETE FROM usuario WHERE nombre = ? OR email = ?', ['admin', 'admin@test.com']);
    
    // Crear usuario de prueba
    const result = await db.insert('usuario', {
      nombre: 'admin',
      apellido: 'Sistema',
      email: 'admin@test.com',
      password: 'admin123', // En texto plano, se hasheará en el primer login
      rol: 1
    });
    
    console.log('✅ Test user created with ID:', result.insertId);
    
    res.json({ 
      message: 'Usuario de prueba creado',
      credentials: {
        username: 'admin',
        password: 'admin123'
      }
    });
  } catch (error) {
    console.error('🔧 Error creating test user:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;