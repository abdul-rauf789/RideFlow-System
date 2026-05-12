

const mysql = require('mysql2');

const db = mysql.createConnection({
  host:     'localhost',   
  user:     'root',       
  password: 'password',  
  database: 'rideflow'     
});

db.connect((err) => {
  if (err) {
    console.log('Database connection FAILED:', err.message);
  } else {
    console.log('Connected to MySQL database!');
  }
});

module.exports = db;
